import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { gateLocacao, podeAprovarProcesso } from "@/lib/locacao/api-gate";
import { tabelaLocacao } from "@/lib/locacao/admin";
import { ligarVinculoManual, LocacaoErro } from "@/lib/locacao/repositorio";

export const dynamic = "force-dynamic";

const corpo = z.object({
  revisao_id: z.string().uuid(),
  acao: z.enum(["ligar", "nao_ligar"]),
  superlogica_pessoa_id: z.string().regex(/^\d+$/).optional(),
}).strict();

export async function GET() {
  const requestId = randomUUID();
  const g = await gateLocacao(requestId, { exigirProcessos: false });
  if (!g.ok) return g.response;
  if (!podeAprovarProcesso(g.gate)) {
    return fail("forbidden_role", g.gate.t("A lista de revisão é só de quem aprova."), 403, { requestId });
  }
  const { data } = await tabelaLocacao(g.gate.admin, "superlogica_vinculo_revisoes")
    .select("id,contact_id,candidatos,categoria,estado,expira_em,created_at")
    .eq("organization_id", g.gate.orgId).eq("estado", "pendente")
    .order("created_at", { ascending: true }).limit(200);
  return ok({ revisoes: data ?? [] }, { requestId });
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const suporte = await requireSupportWrite();
  if (suporte) return suporte;
  const g = await gateLocacao(requestId, { exigirProcessos: false });
  if (!g.ok) return g.response;
  if (!podeAprovarProcesso(g.gate)) {
    return fail("forbidden_role", g.gate.t("A lista de revisão é só de quem aprova."), 403, { requestId });
  }
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", g.gate.t("Pedido inválido."), 422, { requestId });
  const { data: item } = await tabelaLocacao(g.gate.admin, "superlogica_vinculo_revisoes")
    .select("id,contact_id,estado").eq("organization_id", g.gate.orgId)
    .eq("id", parsed.data.revisao_id).maybeSingle();
  if (!item || (item as { estado: string }).estado !== "pendente") {
    return fail("not_found", g.gate.t("Item não encontrado."), 404, { requestId });
  }
  const contactId = String((item as { contact_id: string }).contact_id);
  if (parsed.data.acao === "ligar") {
    if (!parsed.data.superlogica_pessoa_id) {
      return fail("validation_failed", g.gate.t("Escolha a pessoa."), 422, { requestId });
    }
    try {
      await ligarVinculoManual(g.gate.admin, {
        orgId: g.gate.orgId, contactId, pessoaId: parsed.data.superlogica_pessoa_id,
        userId: g.gate.user.id, origem: "casamento_telefone",
      });
    } catch (err) {
      if (err instanceof LocacaoErro) {
        return fail("invalid_state", g.gate.t("Não foi possível ligar."), 409, { requestId });
      }
      throw err;
    }
  }
  await tabelaLocacao(g.gate.admin, "superlogica_vinculo_revisoes").update({
    estado: parsed.data.acao === "ligar" ? "ligado" : "nao_ligar",
    decidido_por: g.gate.user.id,
    decidido_em: new Date().toISOString(),
  }).eq("organization_id", g.gate.orgId).eq("id", parsed.data.revisao_id);
  void audit({
    action: "locacao.vinculo_revisao",
    organizationId: g.gate.orgId, actorUserId: g.gate.user.id, requestId,
    metadata: { revisao_id: parsed.data.revisao_id, acao: parsed.data.acao },
  });
  return ok({ ok: true }, { requestId });
}
