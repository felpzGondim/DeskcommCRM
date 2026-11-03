/**
 * Selo de origem na aba Dados. Reusa o vocabulário `*_origem` do imóvel
 * (manual / Superlógica / conversa) e acrescenta "vazio" quando não há valor.
 * Sem I/O. Sem dado pessoal.
 */
import type { OrigemDoValorDoImovel } from "@/lib/locacao/vocabulario";

export const SELOS_DE_ORIGEM = ["manual", "superlogica", "conversa", "padrao", "vazio"] as const;
export type SeloDeOrigem = (typeof SELOS_DE_ORIGEM)[number];

export const ROTULO_DO_SELO_DE_ORIGEM: Record<SeloDeOrigem, string> = {
  manual: "manual",
  superlogica: "Superlógica",
  conversa: "conversa",
  padrao: "padrão",
  vazio: "vazio",
};

const FONTE_PARA_SELO: Record<string, SeloDeOrigem> = {
  atendente: "manual",
  manual: "manual",
  superlogica: "superlogica",
  conversa: "conversa",
  preliminar_ia: "conversa",
  padrao: "padrao",
};

export function seloDaFonte(fonte: string | null | undefined, temValor: boolean): SeloDeOrigem {
  if (!temValor) return "vazio";
  if (!fonte) return "conversa";
  return FONTE_PARA_SELO[fonte] ?? "conversa";
}

export function seloDaOrigemDoValor(origem: OrigemDoValorDoImovel | null | undefined): SeloDeOrigem {
  if (!origem) return "vazio";
  return origem;
}

export function rotuloDoSeloDeOrigem(selo: SeloDeOrigem): string {
  return ROTULO_DO_SELO_DE_ORIGEM[selo];
}

export function rotuloDaOrigemDoCampo(
  fonte: string | null | undefined,
  temValor: boolean,
): string {
  return rotuloDoSeloDeOrigem(seloDaFonte(fonte, temValor));
}
