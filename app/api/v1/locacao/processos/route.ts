import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { gateLocacao } from "@/lib/locacao/api-gate";
import { tabelaLocacao } from "@/lib/locacao/admin";
import { criarOuReusarImovel, criarProcesso, LocacaoErro } from "@/lib/locacao/repositorio";
import { PAPEIS_DO_PROCESSO, RELACOES_DE_CONTATO_DO_PROCESSO } from "@/lib/locacao/vocabulario";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = randomUUID();
  const g = await gateLocacao(requestId);
  if (!g.ok) return g.response;
  const { data } = await tabelaLocacao(g.gate.admin, "locacao_processos")
    .select("id,status,imovel_id,encerrado_em,status_mudou_em,created_at")
    .eq("organization_id", g.gate.orgId)
    .order("status_mudou_em", { ascending: false })
    .limit(100);
  return ok({ processos: data ?? [] }, { requestId });
}

const criar = z.object({
  conversation_id: z.string().uuid(),
  papel: z.enum(PAPEIS_DO_PROCESSO),
  relacao: z.enum(RELACOES_DE_CONTATO_DO_PROCESSO).nullable().optional(),
  imovel_id: z.string().uuid().optional(),
  superlogica_imovel_id: z.number().int().positive().optional(),
  imovel: z.object({
    logradouro: z.string().trim().min(1).max(180),
    numero: z.string().trim().max(40).optional(),
    complemento: z.string().trim().max(80).optional(),
    bairro: z.string().trim().max(80).optional(),
    cidade: z.string().trim().max(80).optional(),
    uf: z.string().trim().max(2).optional(),
    cep: z.string().trim().max(16).optional(),
    tipo: z.enum(["residencial", "comercial"]).nullable().optional(),
  }).optional(),
}).strict();

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const suporte = await requireSupportWrite();
  if (suporte) return suporte;
  const g = await gateLocacao(requestId);
  if (!g.ok) return g.response;
  const parsed = criar.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", g.gate.t("Pedido inválido."), 422, { requestId });
  const body = parsed.data;
  const { data: conv } = await g.gate.admin.from("conversations")
    .select("id,contact_id").eq("organization_id", g.gate.orgId).eq("id", body.conversation_id).maybeSingle();
  if (!conv) return fail("not_found", g.gate.t("Conversa não encontrada."), 404, { requestId });
  try {
    const imovelId = await criarOuReusarImovel(
      g.gate.admin, g.gate.orgId,
      body.imovel ?? { logradouro: "a definir" },
      { superlogicaImovelId: body.superlogica_imovel_id ?? null, imovelId: body.imovel_id ?? null },
    );
    const id = await criarProcesso(g.gate.admin, {
      orgId: g.gate.orgId, userId: g.gate.user.id, imovelId,
      conversationId: body.conversation_id, contactId: conv.contact_id,
      papelInicial: body.papel, relacao: body.relacao ?? null,
    });
    void audit({
      action: "locacao.processo_criado",
      organizationId: g.gate.orgId, actorUserId: g.gate.user.id, requestId,
      metadata: { processo_id: id, imovel_id: imovelId, papel: body.papel },
    });
    return ok({ id }, { requestId });
  } catch (err) {
    if (err instanceof LocacaoErro) return fail("invalid_state", g.gate.t("Não foi possível criar o processo."), 409, { requestId });
    throw err;
  }
}
