/**
 * Regra 3× da locação: 3 × (aluguel + condomínio + IPTU)
 * contra a renda comprovada pelos créditos do extrato.
 * Seguro-incêndio e seguro-fiança não entram.
 * Exclusões vão para a lista com volume — nunca somam na comprovada.
 */
export const FRASE_3X_SEM_PACOTE = "3x não calculado: falta o valor do pacote";
export const FRASE_3X_SEM_RENDA = "Sem renda comprovada depois das exclusões.";
export const FRASE_3X_COBRE = "A renda comprovada cobre 3× o pacote.";
export const FRASE_3X_ABAIXO =
  "A renda comprovada não cobre 3× o pacote (aluguel+condomínio+IPTU).";

export const MOTIVOS_DE_EXCLUSAO_3X = [
  "propria",
  "familiar",
  "familiar_provavel",
  "poupanca",
  "estorno",
  "emprestimo",
] as const;

export type MotivoDeExclusao3x = (typeof MOTIVOS_DE_EXCLUSAO_3X)[number];

export type ItemExcluido3x = {
  descricao: string;
  valor: number;
};

export type VolumeExcluido3x = {
  motivo: MotivoDeExclusao3x;
  rotulo: string;
  volume: number;
  itens: ItemExcluido3x[];
};

export type EntradaDaRegra3x = {
  aluguel: number | null;
  condominio: number | null;
  iptu: number | null;
  /** Ignorado. A coluna permanece; a regra 3× não usa. */
  seguro_incendio?: number | null;
  /** Informativo. Nunca entra no pacote. */
  seguro_fianca?: number | null;
  comprovada: number | null;
  exclusoes?: Partial<Record<MotivoDeExclusao3x, readonly ItemExcluido3x[]>>;
};

export type ResultadoDaRegra3x = {
  pacote: number | null;
  tres_vezes: number | null;
  comprovada: number | null;
  cobre: boolean | null;
  exclusoes: VolumeExcluido3x[];
  frase: string;
};

const ROTULO: Record<MotivoDeExclusao3x, string> = {
  propria: "transferências próprias",
  familiar: "familiares diretos",
  familiar_provavel: "familiar provável — conferir",
  poupanca: "poupança, resgates e aplicações",
  estorno: "estornos",
  emprestimo: "empréstimos",
};

function reais(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function volumeDe(itens: readonly ItemExcluido3x[] | undefined): number {
  if (!itens?.length) return 0;
  return Math.round(itens.reduce((s, i) => s + Math.abs(i.valor), 0) * 100) / 100;
}

/** Pacote 3×: aluguel + condomínio + IPTU. Sem aluguel = sem 3×. */
export function pacoteDaRegra3x(entrada: Pick<
  EntradaDaRegra3x,
  "aluguel" | "condominio" | "iptu" | "seguro_incendio" | "seguro_fianca"
>): { pacote: number | null; tres_vezes: number | null } {
  const aluguel = reais(entrada.aluguel);
  if (aluguel == null) return { pacote: null, tres_vezes: null };
  const pacote =
    aluguel +
    (reais(entrada.condominio) ?? 0) +
    (reais(entrada.iptu) ?? 0);
  return { pacote: reais(pacote), tres_vezes: reais(pacote * 3) };
}

export function avaliarRegra3x(entrada: EntradaDaRegra3x): ResultadoDaRegra3x {
  const { pacote, tres_vezes } = pacoteDaRegra3x(entrada);
  const comprovada = reais(entrada.comprovada);
  const exclusoes: VolumeExcluido3x[] = [];
  for (const motivo of MOTIVOS_DE_EXCLUSAO_3X) {
    const itens = [...(entrada.exclusoes?.[motivo] ?? [])];
    if (itens.length === 0) continue;
    exclusoes.push({
      motivo,
      rotulo: ROTULO[motivo],
      volume: volumeDe(itens),
      itens,
    });
  }

  if (comprovada == null) {
    return {
      pacote,
      tres_vezes,
      comprovada: null,
      cobre: null,
      exclusoes,
      frase: tres_vezes == null ? `${FRASE_3X_SEM_RENDA} ${FRASE_3X_SEM_PACOTE}` : FRASE_3X_SEM_RENDA,
    };
  }
  if (tres_vezes == null) {
    return {
      pacote,
      tres_vezes: null,
      comprovada,
      cobre: null,
      exclusoes,
      frase: FRASE_3X_SEM_PACOTE,
    };
  }
  const cobre = comprovada >= tres_vezes;
  return {
    pacote,
    tres_vezes,
    comprovada,
    cobre,
    exclusoes,
    frase: cobre ? FRASE_3X_COBRE : FRASE_3X_ABAIXO,
  };
}

export function textoDasExclusoes3x(exclusoes: readonly VolumeExcluido3x[]): string {
  if (exclusoes.length === 0) return "";
  return exclusoes
    .map((e) => `${e.rotulo}: R$ ${e.volume.toFixed(2)}`)
    .join("; ");
}
