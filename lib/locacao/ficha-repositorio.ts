/**
 * Persistência da ficha preliminar: só acrescenta versão. Sem update, sem
 * delete (a retenção de 90 dias fica na Fase 3). `processo_id` nasce nulo.
 *
 * Usa service role e filtra `organization_id` da sessão — nunca do body.
 * A tabela não está no `database.types` gerado (é só deste fork).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { caminhosAlterados } from "@/lib/locacao/ficha-diff";
import {
  fichaPreliminarSchema,
  type FichaPreliminar,
  type OrigemDaFicha,
} from "@/lib/locacao/ficha-schema";

const TABELA = "locacao_fichas_preliminares";

export class FichaConflitoDeVersao extends Error {
  constructor() {
    super("ficha_conflito_de_versao");
    this.name = "FichaConflitoDeVersao";
  }
}

export interface LinhaDaFicha {
  id: string;
  versao: number;
  base_versao: number | null;
  origem: OrigemDaFicha;
  ficha: FichaPreliminar;
  relatorio: string;
  campos_alterados: string[];
  alterado_por: string | null;
  alterado_em: string;
}

export interface ResumoDaVersao {
  versao: number;
  origem: OrigemDaFicha;
  campos_alterados: string[];
  alterado_por: string | null;
  alterado_em: string;
}

function asLinha(row: Record<string, unknown>): LinhaDaFicha {
  const ficha = fichaPreliminarSchema.parse(row.ficha);
  return {
    id: String(row.id),
    versao: Number(row.versao),
    base_versao: row.base_versao === null || row.base_versao === undefined ? null : Number(row.base_versao),
    origem: row.origem as OrigemDaFicha,
    ficha,
    relatorio: typeof row.relatorio === "string" ? row.relatorio : "",
    campos_alterados: Array.isArray(row.campos_alterados)
      ? row.campos_alterados.filter((v): v is string => typeof v === "string")
      : [],
    alterado_por: typeof row.alterado_por === "string" ? row.alterado_por : null,
    alterado_em: typeof row.alterado_em === "string" ? row.alterado_em : "",
  };
}

export async function lerFichaAtual(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
): Promise<LinhaDaFicha | null> {
  const { data, error } = await admin
    .from(TABELA)
    .select("id,versao,base_versao,origem,ficha,relatorio,campos_alterados,alterado_por,alterado_em")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .order("versao", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("ficha_leitura");
  if (!data) return null;
  return asLinha(data as Record<string, unknown>);
}

export async function listarHistoricoDaFicha(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
): Promise<ResumoDaVersao[]> {
  const { data, error } = await admin
    .from(TABELA)
    .select("versao,origem,campos_alterados,alterado_por,alterado_em")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .order("versao", { ascending: false })
    .limit(50);
  if (error) throw new Error("ficha_historico");
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      versao: Number(r.versao),
      origem: r.origem as OrigemDaFicha,
      campos_alterados: Array.isArray(r.campos_alterados)
        ? r.campos_alterados.filter((v): v is string => typeof v === "string")
        : [],
      alterado_por: typeof r.alterado_por === "string" ? r.alterado_por : null,
      alterado_em: typeof r.alterado_em === "string" ? r.alterado_em : "",
    };
  });
}

export async function lerVersaoDaFicha(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
  versao: number,
): Promise<LinhaDaFicha | null> {
  const { data, error } = await admin
    .from(TABELA)
    .select("id,versao,base_versao,origem,ficha,relatorio,campos_alterados,alterado_por,alterado_em")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .eq("versao", versao)
    .maybeSingle();
  if (error) throw new Error("ficha_leitura");
  if (!data) return null;
  return asLinha(data as Record<string, unknown>);
}

export async function gravarVersaoDaFicha(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    conversationId: string;
    ficha: FichaPreliminar;
    relatorio: string;
    origem: OrigemDaFicha;
    baseVersao: number | null;
    alteradoPor: string;
    processoId?: string | null;
  },
): Promise<LinhaDaFicha> {
  const atual = await lerFichaAtual(admin, input.organizationId, input.conversationId);
  const versaoAtual = atual?.versao ?? 0;
  if (input.baseVersao !== versaoAtual) throw new FichaConflitoDeVersao();
  const campos = atual
    ? [
      ...caminhosAlterados(atual.ficha, input.ficha),
      ...(atual.relatorio !== input.relatorio ? ["relatorio"] : []),
    ]
    : ["*"];
  const { data, error } = await admin
    .from(TABELA)
    .insert({
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      processo_id: input.processoId ?? null,
      versao: versaoAtual + 1,
      base_versao: input.baseVersao,
      origem: input.origem,
      ficha: input.ficha,
      relatorio: input.relatorio,
      campos_alterados: campos,
      alterado_por: input.alteradoPor,
    })
    .select("id,versao,base_versao,origem,ficha,relatorio,campos_alterados,alterado_por,alterado_em")
    .single();
  if (error || !data) throw new Error("ficha_gravacao");
  return asLinha(data as Record<string, unknown>);
}
