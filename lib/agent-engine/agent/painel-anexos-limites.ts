/**
 * Limites da leitura de anexos no painel (Fase 2 do processo de locação).
 *
 * Os números abaixo substituem o bloqueio duro de 200 mensagens e o silêncio
 * de PDF/imagem. Dá para afinar em `organizations.settings.locacao.anexos`
 * sem migration; valor ausente ou inválido cai no padrão.
 *
 * Justificativa (PR da Fase 2):
 * - 400 brutas / 80 úteis: conversa longa de locação tem ida e volta, mas o
 *   que importa é anexo ou número (CPF, aluguel, renda). 80 úteis cabem no
 *   bloco de 80 mil caracteres.
 * - 12 PDFs / 8 imagens: RG + holerites + extrato + comprovante de 1–2
 *   pessoas, sem abrir a carteira de visão num click.
 * - 10 MB / 8 páginas de OCR: o WhatsApp já corta arquivo grande; 8 páginas
 *   cobrem RG (2) + holerite (1–3) + comprovante. Q5 do plano seguia aberta.
 * - 15 min de URL assinada: o Hub baixa na hora; URL curta reduz vazamento.
 */
export const LIMITES_ANEXOS_PADRAO = {
  mensagens_brutas: 400,
  mensagens_uteis: 80,
  pdfs: 12,
  imagens: 8,
  bytes_pdf: 10 * 1024 * 1024,
  bytes_imagem: 8 * 1024 * 1024,
  chars_por_arquivo: 40_000,
  chars_conjunto: 80_000,
  chars_ficha_por_anexo: 4_000,
  paginas_ocr: 8,
  url_assinada_segundos: 15 * 60,
  tentativas_senha: 3,
  anexos_ficha: 30,
} as const;

export type LimitesAnexos = { [K in keyof typeof LIMITES_ANEXOS_PADRAO]: number };

const TETO: LimitesAnexos = {
  mensagens_brutas: 800,
  mensagens_uteis: 200,
  pdfs: 20,
  imagens: 16,
  bytes_pdf: 20 * 1024 * 1024,
  bytes_imagem: 12 * 1024 * 1024,
  chars_por_arquivo: 80_000,
  chars_conjunto: 120_000,
  chars_ficha_por_anexo: 8_000,
  paginas_ocr: 12,
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
    mensagens_brutas: inteiro(o.mensagens_brutas, 80, TETO.mensagens_brutas, p.mensagens_brutas),
    mensagens_uteis: inteiro(o.mensagens_uteis, 20, TETO.mensagens_uteis, p.mensagens_uteis),
    pdfs: inteiro(o.pdfs, 1, TETO.pdfs, p.pdfs),
    imagens: inteiro(o.imagens, 1, TETO.imagens, p.imagens),
    bytes_pdf: inteiro(o.bytes_pdf, 1024 * 1024, TETO.bytes_pdf, p.bytes_pdf),
    bytes_imagem: inteiro(o.bytes_imagem, 512 * 1024, TETO.bytes_imagem, p.bytes_imagem),
    chars_por_arquivo: inteiro(o.chars_por_arquivo, 4_000, TETO.chars_por_arquivo, p.chars_por_arquivo),
    chars_conjunto: inteiro(o.chars_conjunto, 10_000, TETO.chars_conjunto, p.chars_conjunto),
    chars_ficha_por_anexo: inteiro(o.chars_ficha_por_anexo, 500, TETO.chars_ficha_por_anexo, p.chars_ficha_por_anexo),
    paginas_ocr: inteiro(o.paginas_ocr, 1, TETO.paginas_ocr, p.paginas_ocr),
    url_assinada_segundos: inteiro(o.url_assinada_segundos, 60, TETO.url_assinada_segundos, p.url_assinada_segundos),
    tentativas_senha: inteiro(o.tentativas_senha, 1, TETO.tentativas_senha, p.tentativas_senha),
    anexos_ficha: inteiro(o.anexos_ficha, 5, TETO.anexos_ficha, p.anexos_ficha),
  };
}

const TEM_NUMERO_OU_ENDERECO =
  /\d{3,}|cpf|cnpj|rg\b|rua |av\.|avenida|alameda|travessa|apto|apartamento|bloco |aluguel|renda|holerite/i;

export function mensagemUtilParaAnalise(linha: Record<string, unknown>): boolean {
  if (linha.revoked_at) return false;
  const tipo = typeof linha.type === "string" ? linha.type : "";
  if (tipo === "document" || tipo === "image") return true;
  const corpo = typeof linha.body === "string" ? linha.body : "";
  const derivado = typeof linha.media_derived_text === "string" ? linha.media_derived_text : "";
  return TEM_NUMERO_OU_ENDERECO.test(`${corpo}\n${derivado}`);
}

/** Últimas N úteis dentro do teto bruto. Entrada já vem da mais nova para a mais velha. */
export function janelaUtilDaAnalise(
  linhas: readonly Record<string, unknown>[],
  limites: Pick<LimitesAnexos, "mensagens_brutas" | "mensagens_uteis"> = LIMITES_ANEXOS_PADRAO,
): Record<string, unknown>[] {
  const recorte = linhas.slice(0, limites.mensagens_brutas);
  const uteis = recorte.filter(mensagemUtilParaAnalise);
  return (uteis.length > 0 ? uteis : recorte).slice(0, limites.mensagens_uteis);
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
