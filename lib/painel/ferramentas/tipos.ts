import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

/** L = o loop chama sozinho. C/S = só o clique humano executa. P não existe. */
export type NivelFerramenta = "L" | "C" | "S";

export type OrigemDaFerramenta = "botao" | "agente";

export interface ContextoDaFerramenta {
  orgId: string;
  conversationId: string;
  contactId: string;
  userId: string;
  requestId: string;
  dbSessao: SupabaseClient;
  admin: SupabaseClient;
  settings: unknown;
  idioma: string;
  phoneNumber?: string | null;
  origem: OrigemDaFerramenta;
  onAndamento?: (etapa: string) => void | Promise<void>;
}

export interface ResultadoDaFerramenta {
  ok: boolean;
  texto: string;
  sugestao?: string;
  links?: Array<{ rotulo: string; url: string }>;
  previaToken?: string | null;
  pronto?: boolean;
  avisos?: unknown[];
  extra?: Record<string, unknown>;
  /** Código de API quando ok=false (tool_unavailable, hub_contract_error…). */
  codigo?: string;
}

export interface DefinicaoDaFerramenta {
  nome: string;
  descricao: string;
  nivel: NivelFerramenta;
  entrada: z.ZodType;
  rotuloAndamento: string;
  /** Atalho de botão que chama esta mesma entrada. Ausente = só o agente. */
  acaoDoBotao?: string;
  /** Futuras entram ligadas no registro; a chave da org ainda desliga o loop. */
  padraoLigada: true;
  executar: (ctx: ContextoDaFerramenta, args: unknown) => Promise<ResultadoDaFerramenta>;
}

export type ParouPor = "fim" | "passos" | "custo" | "tempo";
export type ModoDaConsulta = "normal" | "analise";
export type StatusDaConsulta = "rodando" | "pronto" | "erro";

export interface PropostaDoPainel {
  ferramenta: string;
  nivel: "C" | "S";
  motivo: string;
}

export const TETO_PASSOS_NORMAL = 6;
export const TETO_PASSOS_ANALISE = 10;
export const TETO_CUSTO_NORMAL_USD = 0.05;
export const TETO_CUSTO_ANALISE_USD = 0.3;
export const TETO_TEMPO_NORMAL_MS = 45_000;
export const TETO_TEMPO_ANALISE_MS = 120_000;
export const TETO_MESMA_FERRAMENTA = 3;
