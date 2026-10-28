import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { gateLocacao, podeAprovarProcesso } from "@/lib/locacao/api-gate";
import { lerProcesso, listarParticipantes, mudarStatus, LocacaoErro } from "@/lib/locacao/repositorio";
import { MOTIVOS_DE_CANCELAMENTO, STATUS_DO_PROCESSO, type StatusDoProcesso } from "@/lib/locacao/vocabulario";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const corpo = z.object({
  acao: z.enum(["avancar", "aprovar", "reprovar", "cancelar", "marcar_assinado", "reabrir"]),
  motivo: z.string().trim().min(1).max(180).optional(),
  motivo_cancelamento: z.enum(MOTIVOS_DE_CANCELAMENTO).optional(),
}).strict();

export async function GET(_req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const g = await gateLocacao(requestId);
  if (!g.ok) return g.response;
  const processo = await lerProcesso(g.gate.admin, g.gate.orgId, id);
  if (!processo) return fail("not_found", g.gate.t("Processo não encontrado."), 404, { requestId });
  const participantes = await listarParticipantes(g.gate.admin, g.gate.orgId, id);
  return ok({
    processo,
    participantes,
    pode_aprovar: podeAprovarProcesso(g.gate),
  }, { requestId });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
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
  const de = processo.status as StatusDoProcesso;
  if (!(STATUS_DO_PROCESSO as readonly string[]).includes(de)) {
    return fail("invalid_state", g.gate.t("Status desconhecido."), 409, { requestId });
  }
  const avancar: Partial<Record<StatusDoProcesso, StatusDoProcesso>> = {
    lead: "documentos", documentos: "analise",
  };
  const mapa: Record<typeof parsed.data.acao, StatusDoProcesso | undefined> = {
    avancar: avancar[de],
    aprovar: "aprovado",
    reprovar: "reprovado",
    cancelar: "cancelado",
    marcar_assinado: "contrato_assinado",
    reabrir: "documentos",
  };
  const para = mapa[parsed.data.acao];
  if (!para) return fail("invalid_state", g.gate.t("Não foi possível mudar a etapa."), 409, { requestId });
  const precisaAprovar = parsed.data.acao === "aprovar" || parsed.data.acao === "reabrir";
  if (precisaAprovar && !podeAprovarProcesso(g.gate)) {
    return fail("forbidden_role", g.gate.t("Só quem aprova pode fazer isto."), 403, { requestId });
  }
  try {
    await mudarStatus(g.gate.admin, {
      orgId: g.gate.orgId, processoId: id, de, para,
      quem: precisaAprovar ? "aprovador" : "atendente",
      userId: g.gate.user.id,
      motivo: parsed.data.motivo ?? null,
      motivoCancelamento: parsed.data.motivo_cancelamento ?? null,
    });
    void audit({
      action: parsed.data.acao === "aprovar" ? "locacao.processo_aprovado"
        : parsed.data.acao === "reprovar" ? "locacao.processo_reprovado"
        : parsed.data.acao === "cancelar" ? "locacao.processo_cancelado"
        : parsed.data.acao === "marcar_assinado" ? "locacao.processo_assinado"
        : parsed.data.acao === "avancar" ? "locacao.processo_avancado"
        : "locacao.processo_reaberto",
      organizationId: g.gate.orgId, actorUserId: g.gate.user.id, requestId,
      metadata: { processo_id: id, de, para },
    });
    return ok({ id, status: para }, { requestId });
  } catch (err) {
    if (err instanceof LocacaoErro) {
      const code = err.codigo === "motivo_obrigatorio" ? "validation_failed" : "invalid_state";
      return fail(code, g.gate.t("Não foi possível mudar a etapa."), 409, { requestId });
    }
    throw err;
  }
}
