/**
 * PDF no teto de derivação (8000) volta a ser lido do original, com os
 * mesmos limites da análise/relatório. Foto e outros arquivos no teto
 * não passam daqui — só o aviso em `texto-derivado`.
 */
import { limitesDaAnalise } from "@/lib/agent-engine/agent/painel-anexos-limites";
import {
  enriquecerAnexosDaAnalise,
  type AvisoAnexo,
} from "@/lib/agent-engine/agent/painel-leitura-anexos";
import type { LerDocumentoFn } from "@/lib/ai/visao/ler-documento";
import type { ContextoDaFerramenta } from "@/lib/painel/ferramentas/tipos";
import { derivadoEstaTruncado } from "@/lib/painel/texto-derivado";

export function ehPdfDaConversa(linha: Record<string, unknown>): boolean {
  return linha.type === "document" && linha.media_mime === "application/pdf" && !linha.revoked_at;
}

function chaveDaLinha(linha: Record<string, unknown>): string {
  if (typeof linha.id === "string" && linha.id) return `id:${linha.id}`;
  const path = typeof linha.media_storage_path === "string" ? linha.media_storage_path : "";
  return path ? `path:${path}` : "";
}

export async function reabrirPdfsTruncados(
  linhas: readonly Record<string, unknown>[],
  ctx: Pick<ContextoDaFerramenta, "orgId" | "conversationId" | "admin" | "settings">,
  opcoes: {
    senhas?: Record<string, string>;
    visao?: () => LerDocumentoFn | Promise<LerDocumentoFn>;
  } = {},
): Promise<{ linhas: Record<string, unknown>[]; avisos: AvisoAnexo[] }> {
  const saida = linhas.map((l) => ({ ...l }));
  const alvos = saida.filter((l) => {
    const derivado = typeof l.media_derived_text === "string" ? l.media_derived_text : "";
    return ehPdfDaConversa(l) && derivadoEstaTruncado(derivado, l.original_completo === true);
  });
  if (alvos.length === 0) return { linhas: saida, avisos: [] };
  const limites = limitesDaAnalise(ctx.settings);
  const lerDocumento = opcoes.visao ? await opcoes.visao() : undefined;
  const enriquecido = await enriquecerAnexosDaAnalise(alvos, ctx.orgId, ctx.conversationId, {
    admin: ctx.admin,
    limites,
    senhas: opcoes.senhas,
    lerDocumento,
  });
  const porChave = new Map<string, Record<string, unknown>>();
  for (const linha of enriquecido.linhas) {
    const chave = chaveDaLinha(linha);
    if (chave) porChave.set(chave, linha);
  }
  return {
    linhas: saida.map((linha) => {
      const chave = chaveDaLinha(linha);
      return chave ? (porChave.get(chave) ?? linha) : linha;
    }),
    avisos: enriquecido.avisos,
  };
}
