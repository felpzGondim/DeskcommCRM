/**
 * Consome `painel.relatorio_preliminar_requested`. Gera a ficha no worker;
 * o clique só enfileira. Falha de negócio (JSON/zod/corte) fecha o evento —
 * retry gastaria o mesmo teto de custo. Sem dado pessoal em log.
 */
import type { EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { gerarRelatorioPreliminarDoPainel } from "@/lib/painel/acoes/ficha";
import { montarContexto } from "@/lib/painel/contexto";
import {
  CONSUMIDOR_RELATORIO_PRELIMINAR,
  depositoDeSenhasRedis,
  eventoVencedor,
  gravarResultadoDaGeracao,
  listarGeracoesEmCurso,
  type DepositoDeSenhas,
  type ResultadoDaGeracao,
} from "@/lib/painel/relatorio-preliminar-fila";
import { createAdminClient } from "@/lib/supabase/admin";

export { CONSUMIDOR_RELATORIO_PRELIMINAR };

function uuid(v: unknown): string | null {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
    ? v
    : null;
}

export async function processarRelatorioPreliminar(
  row: EventRow,
  deps: {
    admin?: ReturnType<typeof createAdminClient>;
    gerar?: typeof gerarRelatorioPreliminarDoPainel;
    deposito?: DepositoDeSenhas;
  } = {},
): Promise<HandlerResult> {
  const orgId = row.organization_id;
  const conversationId = uuid(row.payload.conversation_id) ?? uuid(row.entity_id);
  const contactId = uuid(row.payload.contact_id);
  const userId = uuid(row.payload.user_id);
  const requestId = typeof row.payload.request_id === "string" ? row.payload.request_id : row.id;

  if (!conversationId || !contactId || !userId) {
    logger.warn("[painel-ficha] evento sem ids", {
      event_id: row.id,
      organizationId: orgId,
      motivo: "payload_incompleto",
    });
    return { consumer_key: CONSUMIDOR_RELATORIO_PRELIMINAR, status: "skipped", detail: "payload_incompleto" };
  }

  const admin = deps.admin ?? createAdminClient();
  const emCurso = await listarGeracoesEmCurso(admin, orgId, conversationId);
  const vencedor = eventoVencedor(emCurso);
  if (vencedor && vencedor.id !== row.id) {
    return { consumer_key: CONSUMIDOR_RELATORIO_PRELIMINAR, status: "ok", detail: "duplicado" };
  }

  const { data: orgLinha } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();

  const senhas = await (deps.deposito ?? depositoDeSenhasRedis).ler(row.id);
  const ctx = montarContexto({
    orgId,
    conversationId,
    contactId,
    userId,
    requestId,
    dbSessao: admin,
    admin,
    settings: orgLinha?.settings,
    idioma: "pt-BR",
    origem: "botao",
  });

  const gerar = deps.gerar ?? gerarRelatorioPreliminarDoPainel;
  let resultado: ResultadoDaGeracao;
  try {
    const r = await gerar(ctx, senhas, { eventoId: row.id });
    if (r.ok) {
      const versao = typeof r.extra?.versao === "number" ? r.extra.versao : 0;
      resultado = { ok: true, versao };
    } else if (r.codigo === "idempotency_in_progress") {
      return { consumer_key: CONSUMIDOR_RELATORIO_PRELIMINAR, status: "ok", detail: "duplicado" };
    } else {
      const motivoBruto = r.extra?.motivo;
      const motivo =
        motivoBruto === "saida_truncada" ||
        motivoBruto === "extrator_json" ||
        motivoBruto === "relatorio_json" ||
        motivoBruto === "zod" ||
        motivoBruto === "invalid_format"
          ? motivoBruto
          : r.codigo === "saida_truncada"
            ? "saida_truncada"
            : "relatorio_json";
      resultado = { ok: false, motivo };
      logger.error("[painel-ficha] falha ao gerar relatório", {
        requestId,
        organizationId: orgId,
        codigo: r.codigo ?? "invalid_format",
        motivo,
        etapa: "worker",
      });
    }
  } catch (err) {
    logger.error("[painel-ficha] falha ao gerar relatório", {
      requestId,
      organizationId: orgId,
      codigo: "internal_error",
      motivo: "invalid_format",
      etapa: "worker",
    });
    return {
      consumer_key: CONSUMIDOR_RELATORIO_PRELIMINAR,
      status: "error",
      detail: err instanceof Error ? err.message.slice(0, 80) : "worker",
    };
  }

  await gravarResultadoDaGeracao(admin, {
    orgId,
    eventoId: row.id,
    payload: row.payload,
    resultado,
  });
  void audit({
    action: "ai.painel_atendente.ficha_preliminar",
    actorUserId: userId,
    organizationId: orgId,
    resourceType: "conversation",
    resourceId: conversationId,
    requestId,
    metadata: {
      sucesso: resultado.ok,
      evento_id: row.id,
      ...(resultado.ok ? { versao: resultado.versao, campos: ["*"] } : { motivo: resultado.motivo }),
    },
  });
  return { consumer_key: CONSUMIDOR_RELATORIO_PRELIMINAR, status: "ok" };
}
