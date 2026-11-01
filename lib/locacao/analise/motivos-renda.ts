/**
 * Motivos simples em português da análise de renda. Nunca engolir falha.
 * Sem dado pessoal neste arquivo.
 */

export const MOTIVOS_RENDA = {
  leitura_imagem_falhou: "leitura de imagem falhou",
  extrato_ilegivel: "extrato ilegível",
  timeout: "timeout",
  pdf_senha: "PDF protegido por senha",
  sem_processo: "Abra um processo de locação antes de analisar a renda.",
  desligada: "Esta análise não está ligada nesta organização.",
  conversa: "Não foi possível ler a conversa para analisar a renda.",
  gravacao: "Não foi possível gravar a análise de renda.",
  conflito: "Outra pessoa alterou a ficha. Recarregue e analise de novo.",
  documentos: "Não foi possível analisar a renda. Confira os documentos e tente novamente.",
} as const;

export type MotivoRenda = (typeof MOTIVOS_RENDA)[keyof typeof MOTIVOS_RENDA];

export type MotivoLeituraDocumental =
  | "sem_provedor"
  | "falha"
  | "sem_credito"
  | "ilegivel"
  | "timeout"
  | "senha";

/** Traduz o motivo técnico da visão para a frase que a tela mostra. */
export function fraseDoMotivoDeLeitura(motivo: MotivoLeituraDocumental | string): string {
  if (motivo === "ilegivel") return MOTIVOS_RENDA.extrato_ilegivel;
  if (motivo === "timeout") return MOTIVOS_RENDA.timeout;
  if (motivo === "senha") return MOTIVOS_RENDA.pdf_senha;
  return MOTIVOS_RENDA.leitura_imagem_falhou;
}

/** Lê o erro cru da visão (402, timeout, senha) sem vazar detalhe técnico. */
export function motivoDeLeituraDoErro(err: unknown): MotivoLeituraDocumental {
  const texto = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? "");
  if (/402|Payment Required/i.test(texto)) return "sem_credito";
  if (/timeout|ETIMEDOUT|AbortError|UND_ERR_CONNECT_TIMEOUT/i.test(texto)) return "timeout";
  if (/password|senha|protegido/i.test(texto)) return "senha";
  return "falha";
}
