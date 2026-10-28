/**
 * Tipos das tabelas de locação deste fork. `locacao_analises_seguro` também
 * entra em `lib/database.types.ts` (à mão: o dump gerado é do upstream).
 * Sem dado pessoal neste arquivo.
 */
import type { Json } from "@/lib/database.types";
import type {
  EstadoDaAnaliseFc,
  EstadoDaAnaliseSeguro,
  OrigemDaAnalise,
} from "@/lib/locacao/vocabulario";

export type LocacaoAnaliseSeguroRow = {
  id: string;
  organization_id: string;
  processo_id: string;
  participante_id: string | null;
  pedido_id: string;
  hub_job_id: string | null;
  ficha_versao: number | null;
  estado: EstadoDaAnaliseSeguro;
  origem: OrigemDaAnalise;
  documento_id: string | null;
  autorizado_por: string | null;
  autorizado_em: string | null;
  resultado: Json | null;
  erro_codigo: string | null;
  hub_estado: string | null;
  concluida_em: string | null;
  created_at: string;
  updated_at: string;
};

export type LocacaoAnaliseFcColunasNovas = {
  origem: OrigemDaAnalise;
  documento_id: string | null;
  erro_codigo: string | null;
  hub_estado: string | null;
  estado: EstadoDaAnaliseFc;
};

export type LocacaoProcessoColunasFase4 = {
  renda_confirmada_em: string | null;
  renda_confirmada_por: string | null;
  renda_confirmada_ficha_versao: number | null;
  relatorio_rascunho: string | null;
  relatorio_rascunho_em: string | null;
  relatorio_rascunho_por: string | null;
  relatorio_aprovado_em: string | null;
  relatorio_aprovado_por: string | null;
  relatorio_documento_id: string | null;
};
