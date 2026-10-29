/**
 * Fila do relatório preliminar — `event_log` + dreno do worker.
 * Sem tabela nova: o andamento sai do status do evento (pending/processing/done/dead).
 * Senha de PDF não entra no evento; vai para Redis com TTL curto, se houver.
 */
import { Redis } from "@upstash/redis";
import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { MotivoFalhaRelatorio } from "@/lib/painel/relatorio-preliminar-motivo";
import { validarConfigRedisRest } from "@/lib/redis-config";

import {
  CONSUMIDOR_RELATORIO_PRELIMINAR,
  EVENTO_RELATORIO_PRELIMINAR,
  MS_CONSULTA_DA_GERACAO,
} from "@/lib/painel/relatorio-preliminar";

export {
  CONSUMIDOR_RELATORIO_PRELIMINAR,
  EVENTO_RELATORIO_PRELIMINAR,
  MS_CONSULTA_DA_GERACAO,
};

export type StatusDaGeracao = "gerando" | "erro";

export type ResultadoDaGeracao =
  | { ok: true; versao: number }
  | { ok: false; motivo: MotivoFalhaRelatorio };

export type GeracaoDaFicha = {
  status: StatusDaGeracao;
  motivo: MotivoFalhaRelatorio | null;
  eventoId: string;
};

export type EventoDaGeracao = {
  id: string;
  status: string;
  created_at: string | null;
  payload: Record<string, unknown>;
};

export type DepositoDeSenhas = {
  guardar(eventoId: string, senhas: Record<string, string>): Promise<void>;
  ler(eventoId: string): Promise<Record<string, string>>;
};

const PREFIXO_SENHA = "painel:relatorio-preliminar:senhas:";
const TTL_SENHA_S = 15 * 60;
const TIMEOUT_REDIS_MS = 2_000;

let _redis: Redis | null | undefined;

function redisOpcional(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  const config = validarConfigRedisRest(url, token);
  _redis = config.ok ? new Redis({ url, token }) : null;
  return _redis;
}

export const depositoDeSenhasRedis: DepositoDeSenhas = {
  async guardar(eventoId, senhas) {
    if (Object.keys(senhas).length === 0) return;
    const redis = redisOpcional();
    if (!redis) return;
    try {
      await Promise.race([
        redis.set(`${PREFIXO_SENHA}${eventoId}`, senhas, { ex: TTL_SENHA_S }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("senha_timeout")), TIMEOUT_REDIS_MS),
        ),
      ]);
    } catch {
      logger.warn("[painel-ficha] senhas da geração não ficaram no depósito", {
        organizationId: null,
        motivo: "deposito_indisponivel",
      });
    }
  },
  async ler(eventoId) {
    const redis = redisOpcional();
    if (!redis) return {};
    try {
      const valor = await Promise.race([
        redis.get<Record<string, string>>(`${PREFIXO_SENHA}${eventoId}`),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("senha_timeout")), TIMEOUT_REDIS_MS),
        ),
      ]);
      return valor && typeof valor === "object" ? valor : {};
    } catch {
      return {};
    }
  },
};

function payloadDoEvento(row: { payload?: unknown }): Record<string, unknown> {
  return row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? (row.payload as Record<string, unknown>)
    : {};
}

export function resultadoDoPayload(payload: Record<string, unknown>): ResultadoDaGeracao | null {
  const bruto = payload.resultado;
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const r = bruto as Record<string, unknown>;
  if (r.ok === true && typeof r.versao === "number") return { ok: true, versao: r.versao };
  if (r.ok === false && typeof r.motivo === "string") {
    return { ok: false, motivo: r.motivo as MotivoFalhaRelatorio };
  }
  return null;
}

export async function listarGeracoesEmCurso(
  admin: SupabaseClient,
  orgId: string,
  conversationId: string,
): Promise<EventoDaGeracao[]> {
  const { data, error } = await admin
    .from("event_log")
    .select("id,status,payload,created_at")
    .eq("organization_id", orgId)
    .eq("event_type", EVENTO_RELATORIO_PRELIMINAR)
    .eq("entity_id", conversationId)
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: true })
    .limit(8);
  if (error) throw new Error("geracao_leitura");
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      status: String(r.status ?? ""),
      created_at: typeof r.created_at === "string" ? r.created_at : null,
      payload: payloadDoEvento(r),
    };
  });
}

export function eventoVencedor(eventos: EventoDaGeracao[]): EventoDaGeracao | null {
  return eventos[0] ?? null;
}

export async function enfileirarRelatorioPreliminar(
  admin: SupabaseClient,
  input: {
    orgId: string;
    conversationId: string;
    contactId: string;
    userId: string;
    requestId: string;
    senhas?: Record<string, string>;
    deposito?: DepositoDeSenhas;
  },
): Promise<{ eventoId: string; existente: boolean }> {
  const emCurso = await listarGeracoesEmCurso(admin, input.orgId, input.conversationId);
  const vencedor = eventoVencedor(emCurso);
  if (vencedor) return { eventoId: vencedor.id, existente: true };

  const { data, error } = await admin.rpc("emit_event" as never, {
    p_event_type: "painel.relatorio_preliminar_requested",
    p_entity_kind: "conversation",
    p_entity_id: input.conversationId,
    p_payload: {
      conversation_id: input.conversationId,
      contact_id: input.contactId,
      user_id: input.userId,
      request_id: input.requestId,
    },
    p_metadata: { source: "botao" },
    p_organization_id: input.orgId,
  } as never);
  if (error || typeof data !== "string") {
    logger.error("[painel-ficha] falha ao enfileirar relatório", {
      requestId: input.requestId,
      organizationId: input.orgId,
      motivo: "emit_event",
    });
    throw new Error("geracao_enfileirar");
  }

  const deNovo = await listarGeracoesEmCurso(admin, input.orgId, input.conversationId);
  const primeiro = eventoVencedor(deNovo);
  if (primeiro && primeiro.id !== data) {
    return { eventoId: primeiro.id, existente: true };
  }

  const senhas = input.senhas ?? {};
  if (Object.keys(senhas).length > 0) {
    await (input.deposito ?? depositoDeSenhasRedis).guardar(data, senhas);
  }
  return { eventoId: data, existente: false };
}

export async function lerGeracaoDaFicha(
  admin: SupabaseClient,
  orgId: string,
  conversationId: string,
): Promise<GeracaoDaFicha | null> {
  const emCurso = await listarGeracoesEmCurso(admin, orgId, conversationId);
  const vencedor = eventoVencedor(emCurso);
  if (vencedor) return { status: "gerando", motivo: null, eventoId: vencedor.id };

  const { data, error } = await admin
    .from("event_log")
    .select("id,status,payload,created_at")
    .eq("organization_id", orgId)
    .eq("event_type", EVENTO_RELATORIO_PRELIMINAR)
    .eq("entity_id", conversationId)
    .in("status", ["done", "dead"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("geracao_leitura");
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const resultado = resultadoDoPayload(payloadDoEvento(row));
  if (!resultado || resultado.ok) return null;
  return { status: "erro", motivo: resultado.motivo, eventoId: String(row.id) };
}

export async function gravarResultadoDaGeracao(
  admin: SupabaseClient,
  input: { orgId: string; eventoId: string; payload: Record<string, unknown>; resultado: ResultadoDaGeracao },
): Promise<void> {
  const { error } = await admin
    .from("event_log")
    .update({
      payload: { ...input.payload, resultado: input.resultado },
      last_error: input.resultado.ok ? null : input.resultado.motivo,
    })
    .eq("organization_id", input.orgId)
    .eq("id", input.eventoId);
  if (error) throw new Error("geracao_resultado");
}
