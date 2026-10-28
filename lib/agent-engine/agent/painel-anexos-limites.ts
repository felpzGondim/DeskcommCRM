/**
 * Limites da leitura de anexos no painel (Fase 2 do processo de locação).
 *
 * Dá para afinar em `organizations.settings.locacao.anexos` sem migration;
 * valor ausente ou inválido cai no padrão. Decisão do Felipe no PR #15:
 * 200 mensagens mais recentes (sem filtro de “úteis”, sem 422) e PDF
 * escaneado até 30 páginas (extrato bancário longo).
 *
 * Justificativa dos números:
 * - 200 mensagens: o atendente pediu a janela recente, não um recorte
 *   “útil”. Conversa maior não bloqueia — só não lê o que passou de 200.
 * - 20 MB / 30 páginas: extrato escaneado no WhatsApp fica ~0,5–0,7 MB
 *   por página; 30 páginas cabem em 20 MB. Texto puro é bem menor.
 * - 120 mil caracteres/arquivo: ~4 mil por página × 30 (tabela de extrato).
 * - 200 mil no conjunto: um extrato longo + RG + holerites de 1–2 pessoas.
 *   Gemini Flash (visao_de_imagem) tem contexto de 1M tokens; o teto é o
 *   token da prévia (500 mil) e o tempo da rota, não o modelo.
 * - 5 páginas/lote no fallback: o caminho feliz manda o PDF inteiro numa
 *   chamada. Se a visão no PDF falhar, o raster vai de 5 em 5 (no máximo
 *   6 chamadas), não 30 — timeout e custo.
 * - 20 mil na ficha: o Hub classifica; não precisa do extrato inteiro.
 */
export const LIMITES_ANEXOS_PADRAO = {
  mensagens_brutas: 200,
  pdfs: 12,
  imagens: 8,
  bytes_pdf: 20 * 1024 * 1024,
  bytes_imagem: 8 * 1024 * 1024,
  chars_por_arquivo: 120_000,
  chars_conjunto: 200_000,
  chars_ficha_por_anexo: 20_000,
  paginas_ocr: 30,
  paginas_por_lote_ocr: 5,
  url_assinada_segundos: 15 * 60,
  tentativas_senha: 3,
  anexos_ficha: 30,
} as const;

/** Teto do token cifrado da prévia: um extrato de 30 páginas não cabia em 120 mil. */
export const TETO_TOKEN_PREVIA = 500_000;

export type LimitesAnexos = { [K in keyof typeof LIMITES_ANEXOS_PADRAO]: number };

const TETO: LimitesAnexos = {
  mensagens_brutas: 400,
  pdfs: 20,
  imagens: 16,
  bytes_pdf: 30 * 1024 * 1024,
  bytes_imagem: 12 * 1024 * 1024,
  chars_por_arquivo: 200_000,
  chars_conjunto: 300_000,
  chars_ficha_por_anexo: 40_000,
  paginas_ocr: 40,
  paginas_por_lote_ocr: 10,
  url_assinada_segundos: 30 * 60,
  tentativas_senha: 3,
  anexos_ficha: 40,
};

function inteiro(valor: unknown, minimo: number, maximo: number, padrao: number): number {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return padrao;
  return Math.min(maximo, Math.max(minimo, Math.trunc(valor)));
}

/** Lê o recorte opcional em `organizations.settings.locacao.anexos`. Nunca lança. */
export function limitesDaAnalise(settings: unknown): LimitesAnexos {
  const locacao = settings && typeof settings === "object"
    ? (settings as Record<string, unknown>).locacao : undefined;
  const bruto = locacao && typeof locacao === "object"
    ? (locacao as Record<string, unknown>).anexos : undefined;
  const o = bruto && typeof bruto === "object" ? bruto as Record<string, unknown> : {};
  const p = LIMITES_ANEXOS_PADRAO;
  return {
    mensagens_brutas: inteiro(o.mensagens_brutas ?? o.mensagens, 50, TETO.mensagens_brutas, p.mensagens_brutas),
    pdfs: inteiro(o.pdfs, 1, TETO.pdfs, p.pdfs),
    imagens: inteiro(o.imagens, 1, TETO.imagens, p.imagens),
    bytes_pdf: inteiro(o.bytes_pdf, 1024 * 1024, TETO.bytes_pdf, p.bytes_pdf),
    bytes_imagem: inteiro(o.bytes_imagem, 512 * 1024, TETO.bytes_imagem, p.bytes_imagem),
    chars_por_arquivo: inteiro(o.chars_por_arquivo, 4_000, TETO.chars_por_arquivo, p.chars_por_arquivo),
    chars_conjunto: inteiro(o.chars_conjunto, 10_000, TETO.chars_conjunto, p.chars_conjunto),
    chars_ficha_por_anexo: inteiro(o.chars_ficha_por_anexo, 500, TETO.chars_ficha_por_anexo, p.chars_ficha_por_anexo),
    paginas_ocr: inteiro(o.paginas_ocr, 1, TETO.paginas_ocr, p.paginas_ocr),
    paginas_por_lote_ocr: inteiro(o.paginas_por_lote_ocr, 1, TETO.paginas_por_lote_ocr, p.paginas_por_lote_ocr),
    url_assinada_segundos: inteiro(o.url_assinada_segundos, 60, TETO.url_assinada_segundos, p.url_assinada_segundos),
    tentativas_senha: inteiro(o.tentativas_senha, 1, TETO.tentativas_senha, p.tentativas_senha),
    anexos_ficha: inteiro(o.anexos_ficha, 5, TETO.anexos_ficha, p.anexos_ficha),
  };
}

/** Últimas N mensagens. Entrada já vem da mais nova para a mais velha. Sem filtro. */
export function janelaUtilDaAnalise(
  linhas: readonly Record<string, unknown>[],
  limites: Pick<LimitesAnexos, "mensagens_brutas"> = LIMITES_ANEXOS_PADRAO,
): Record<string, unknown>[] {
  return linhas.slice(0, limites.mensagens_brutas);
}

/**
 * Legenda e texto derivado COEXISTEM. `body ?? derivado` descarta o OCR/visão
 * sempre que o cliente escreveu uma legenda — era o defeito da Fase 2.
 */
export function textoCombinadoDaMensagem(corpo: unknown, derivado: unknown): string {
  const a = typeof corpo === "string" ? corpo.trim() : "";
  const b = typeof derivado === "string" ? derivado.trim() : "";
  if (a && b && a !== b) return `${a}\n${b}`;
  return a || b;
}

/** Descrição curta do worker ("parece um extrato") não prova valor financeiro. */
export function ehDescricaoGenericaDeMidia(texto: string): boolean {
  const t = texto.trim();
  if (t.length === 0 || t.length > 280) return false;
  return /parece (um|uma)|parece ser|foto de|imagem de|print de|comprovante visível|documento visível/i.test(t)
    && !/\d{3,}/.test(t);
}

export function rotuloDoLimite(limites: LimitesAnexos): string {
  const mbPdf = Math.round(limites.bytes_pdf / (1024 * 1024));
  const mbImg = Math.round(limites.bytes_imagem / (1024 * 1024));
  return `Até ${limites.pdfs} PDFs de ${mbPdf} MB e ${limites.imagens} fotos de ${mbImg} MB. PDF escaneado: até ${limites.paginas_ocr} páginas.`;
}
