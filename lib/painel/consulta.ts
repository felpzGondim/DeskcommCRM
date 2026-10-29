/**
 * Registro da pergunta do painel (`agent_panel_query_log`). Service role + org.
 * Texto da pergunta/resposta entra na cascata LGPD (gatilho em contacts).
 */
import { tabelaPainel } from "@/lib/painel/admin";
import { mascararPessoaNoTexto, parametrosSemPii } from "@/lib/painel/mascarar";
import type { ParouPor } from "@/lib/painel/ferramentas/tipos";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PassoDoLog = {
  nome: string;
  nivel: string;
  parametros: unknown;
  ok: boolean;
  ms: number;
};

/** Sem atualização por este tempo, o GET devolve `interrompida` (não grava). */
export const MS_SEM_ATUALIZACAO_INTERROMPE = 150_000;

export type StatusLidoDaConsulta = "rodando" | "pronto" | "erro" | "interrompida";

export type AndamentoDaConsulta = {
  etapa: string | null;
  status: StatusLidoDaConsulta;
  resposta: string | null;
  propostas: unknown[];
  parou_por: string | null;
  modo: "normal" | "analise" | null;
  updated_at: string | null;
};

export async function abrirConsulta(
  admin: SupabaseClient,
  input: {
    id: string;
    orgId: string;
    conversationId: string;
    contactId: string;
    userId: string;
    pergunta: string;
    modo: "normal" | "analise";
  },
): Promise<"criada" | "existente"> {
  const { error } = await tabelaPainel(admin, "agent_panel_query_log").insert({
    id: input.id,
    organization_id: input.orgId,
    conversation_id: input.conversationId,
    contact_id: input.contactId,
    user_id: input.userId,
    pergunta: mascararPessoaNoTexto(input.pergunta).slice(0, 4000),
    modo: input.modo,
    status: "rodando",
    etapa_atual: "gerando resumo…",
    ferramentas: [],
    propostas: [],
  });
  if (!error) return "criada";
  if ((error as { code?: string }).code === "23505") return "existente";
  throw error;
}

export async function atualizarEtapa(
  admin: SupabaseClient,
  orgId: string,
  id: string,
  etapa: string,
): Promise<void> {
  await tabelaPainel(admin, "agent_panel_query_log")
    .update({ etapa_atual: etapa.slice(0, 180), updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("id", id);
}

export async function fecharConsulta(
  admin: SupabaseClient,
  input: {
    id: string;
    orgId: string;
    resposta: string;
    passos: PassoDoLog[];
    propostas: unknown[];
    tokensEntrada: number;
    tokensSaida: number;
    custoUsd: number;
    duracaoMs: number;
    parouPor: ParouPor;
    llmCallIds: string[];
    modo: "normal" | "analise";
    status?: "pronto" | "erro";
  },
): Promise<void> {
  await tabelaPainel(admin, "agent_panel_query_log")
    .update({
      resposta: mascararPessoaNoTexto(input.resposta).slice(0, 16_000),
      passos: input.passos.length,
      ferramentas: input.passos.map((p) => ({
        ...p,
        parametros: parametrosSemPii(p.parametros),
      })),
      propostas: input.propostas,
      tokens_entrada: input.tokensEntrada,
      tokens_saida: input.tokensSaida,
      custo_usd: input.custoUsd,
      duracao_ms: input.duracaoMs,
      parou_por: input.parouPor,
      llm_call_ids: input.llmCallIds,
      modo: input.modo,
      status: input.status ?? "pronto",
      etapa_atual: null,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", input.orgId)
    .eq("id", input.id);
}

function statusLido(
  status: string,
  updatedAt: string | null,
  agoraMs = Date.now(),
): StatusLidoDaConsulta {
  if (status === "pronto" || status === "erro") return status;
  if (status === "rodando" && updatedAt) {
    const idade = agoraMs - Date.parse(updatedAt);
    if (Number.isFinite(idade) && idade > MS_SEM_ATUALIZACAO_INTERROMPE) return "interrompida";
  }
  return status === "rodando" ? "rodando" : "erro";
}

export function andamentoDeLinha(
  row: {
    etapa_atual: string | null;
    status: string;
    resposta?: string | null;
    propostas?: unknown;
    parou_por?: string | null;
    modo?: string | null;
    updated_at?: string | null;
  },
  agoraMs = Date.now(),
): AndamentoDaConsulta {
  const propostas = Array.isArray(row.propostas) ? row.propostas : [];
  const modo = row.modo === "analise" || row.modo === "normal" ? row.modo : null;
  return {
    etapa: row.etapa_atual,
    status: statusLido(row.status, row.updated_at ?? null, agoraMs),
    resposta: typeof row.resposta === "string" ? row.resposta : null,
    propostas,
    parou_por: typeof row.parou_por === "string" ? row.parou_por : null,
    modo,
    updated_at: row.updated_at ?? null,
  };
}

export async function lerAndamento(
  db: SupabaseClient,
  orgId: string,
  id: string,
  conversationId?: string,
): Promise<AndamentoDaConsulta | null> {
  let q = db
    .from("agent_panel_query_log" as never)
    .select("etapa_atual,status,resposta,propostas,parou_por,modo,updated_at")
    .eq("organization_id", orgId)
    .eq("id", id);
  if (conversationId) q = q.eq("conversation_id", conversationId);
  const { data } = await q.maybeSingle();
  if (!data) return null;
  return andamentoDeLinha(
    data as {
      etapa_atual: string | null;
      status: string;
      resposta?: string | null;
      propostas?: unknown;
      parou_por?: string | null;
      modo?: string | null;
      updated_at?: string | null;
    },
  );
}
