import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { camposCpfDoParticipante } from "@/lib/locacao/cpf";
import { gateLocacao } from "@/lib/locacao/api-gate";
import { adicionarParticipante, lerProcesso, LocacaoErro } from "@/lib/locacao/repositorio";
import { PAPEIS_DO_PROCESSO, RELACOES_DE_CONTATO_DO_PROCESSO } from "@/lib/locacao/vocabulario";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const corpo = z.object({
  contact_id: z.string().uuid().nullable().optional(),
  papel: z.enum(PAPEIS_DO_PROCESSO),
  relacao: z.enum(RELACOES_DE_CONTATO_DO_PROCESSO).nullable().optional(),
  principal: z.boolean().optional(),
  cpf: z.string().trim().max(18).optional(),
  nome_exibicao: z.string().trim().max(120).optional(),
  fracao: z.number().min(0).max(100).nullable().optional(),
}).strict();

export async function POST(req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const suporte = await requireSupportWrite();
  if (suporte) return suporte;
  const { id } = await ctx.params;
  const g = await gateLocacao(requestId);
  if (!g.ok) return g.response;
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", g.gate.t("Pedido inválido."), 422, { requestId });
  const processo = await lerProcesso(g.gate.admin, g.gate.orgId, id);
  if (!processo) return fail("not_found", g.gate.t("Processo não encontrado."), 404, { requestId });
  if (parsed.data.contact_id) {
    const { data: c } = await g.gate.admin.from("contacts").select("id")
      .eq("organization_id", g.gate.orgId).eq("id", parsed.data.contact_id).maybeSingle();
    if (!c) return fail("not_found", g.gate.t("Contato não encontrado."), 404, { requestId });
  }
  const cpf = parsed.data.cpf
    ? await camposCpfDoParticipante(g.gate.admin, parsed.data.cpf)
    : {};
  try {
    const pid = await adicionarParticipante(g.gate.admin, {
      orgId: g.gate.orgId, processoId: id, userId: g.gate.user.id,
      contactId: parsed.data.contact_id ?? null,
      papel: parsed.data.papel, relacao: parsed.data.relacao ?? null,
      principal: parsed.data.principal,
      cpfHash: cpf.cpf_hash ?? null,
      cpfMascarado: cpf.cpf_mascarado ?? null,
      cpfEncrypted: cpf.cpf_encrypted ?? null,
      nomeExibicao: parsed.data.nome_exibicao ?? null,
      fracao: parsed.data.fracao ?? null,
    });
    void audit({
      action: "locacao.participante_adicionado",
      organizationId: g.gate.orgId, actorUserId: g.gate.user.id, requestId,
      metadata: { processo_id: id, participante_id: pid, papel: parsed.data.papel },
    });
    return ok({ id: pid }, { requestId });
  } catch (err) {
    if (err instanceof LocacaoErro) return fail("invalid_state", g.gate.t("Não foi possível adicionar a pessoa."), 409, { requestId });
    throw err;
  }
}
