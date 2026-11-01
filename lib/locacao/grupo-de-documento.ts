/**
 * Classificação da aba Documentos por origem. Pura: sem cliente, sem Hub, sem
 * banco. A origem `mensagem`/`processo` é o ponteiro da URL assinada; a origem
 * do arquivo e a categoria vêm do que o banco já grava.
 *
 * Grupo `ficha_cadastral` fica preparado. Hoje nenhum CHECK de
 * `locacao_processo_documentos` tem origem/categoria `ficha_cadastral` — o PR
 * de banco precisa acrescentá-las (e o caminho
 * `{org}/processos/{id}/ficha_cadastral/`) para a ficha impressa e o
 * "imprimir ficha" da Migra que ainda não têm tipo.
 */

export const GRUPOS_DE_DOCUMENTO = [
  "inquilino",
  "ficha_cadastral",
  "laudo_fc",
  "migra",
  "contrato",
] as const;

export type GrupoDeDocumento = (typeof GRUPOS_DE_DOCUMENTO)[number];

export const ROTULOS_DO_GRUPO = {
  inquilino: "Inquilino",
  ficha_cadastral: "Ficha cadastral impressa",
  laudo_fc: "Laudo da FC",
  migra: "Migra",
  contrato: "Contrato",
} as const satisfies Record<GrupoDeDocumento, string>;

export const TEXTO_GRUPO_VAZIO = "nenhum arquivo ainda";

export const TIPOS_PENDENTES_FICHA_CADASTRAL = {
  origem: "ficha_cadastral",
  categoria: "ficha_cadastral",
} as const;

export type OrigemDaListaDeDocumento = "mensagem" | "processo";

export type CamposParaAgrupar = {
  origem: OrigemDaListaDeDocumento;
  origem_arquivo?: string | null;
  categoria?: string | null;
};

export function grupoDoDocumento(doc: CamposParaAgrupar): GrupoDeDocumento {
  const origemArquivo = doc.origem_arquivo ?? "";
  const categoria = doc.categoria ?? "";
  if (categoria === "contrato") return "contrato";
  if (categoria === "laudo_fc" || origemArquivo === "hub_fc") return "laudo_fc";
  if (categoria === "cotacao_seguro" || origemArquivo === "hub_migra") return "migra";
  if (
    categoria === TIPOS_PENDENTES_FICHA_CADASTRAL.categoria
    || origemArquivo === TIPOS_PENDENTES_FICHA_CADASTRAL.origem
  ) {
    return "ficha_cadastral";
  }
  return "inquilino";
}

export function agruparDocumentos<T extends CamposParaAgrupar>(
  docs: readonly T[],
): Record<GrupoDeDocumento, T[]> {
  const grupos = {
    inquilino: [] as T[],
    ficha_cadastral: [] as T[],
    laudo_fc: [] as T[],
    migra: [] as T[],
    contrato: [] as T[],
  };
  for (const doc of docs) grupos[grupoDoDocumento(doc)].push(doc);
  return grupos;
}

export function hrefAssinadoDoDocumento(input: {
  conversationId: string;
  id: string;
  origem: OrigemDaListaDeDocumento;
  download?: boolean;
}): string {
  const q = new URLSearchParams({
    arquivo: input.id,
    origem: input.origem,
    redirect: "1",
  });
  if (input.download) q.set("download", "1");
  return `/api/v1/conversations/${input.conversationId}/locacao/documentos?${q.toString()}`;
}
