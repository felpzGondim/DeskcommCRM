/**
 * Contrato do bloco de renda que o relatório 4.5 consome.
 *
 * Quem calcula (créditos do extrato, exclusões, tabela mensal) é
 * `lib/locacao/extrato/` — PR separado sobre a main, com o preliminar.
 * Este módulo só aceita o bloco já pronto. Sem prompt, sem parser de
 * lançamento, sem copiar a renda declarada para a comprovada.
 *
 * Quando o PR do motor mesclar, o rebase troca `brutoDoBlocoDeRenda`
 * para a função canônica de lá. Até lá, bloco ausente = seção pendente.
 */
export const TEXTO_BLOCO_RENDA_AUSENTE =
  "Pendente — o bloco de renda ainda não foi calculado. A renda declarada não entra no lugar.";

export type BlocoDeRendaCalculado = {
  comprovada: number | null;
  declarada: number | null;
  tabela: string | null;
  motivo_nao_comprovacao: string | null;
  pacote: number | null;
  tres_vezes_pacote: number | null;
  abaixo_de_3x: boolean | null;
};

function numero(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor)
    ? Math.round(valor * 100) / 100
    : null;
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

export function blocoDeRendaAusente(declarada: number | null = null): BlocoDeRendaCalculado {
  return {
    comprovada: null,
    declarada,
    tabela: null,
    motivo_nao_comprovacao: TEXTO_BLOCO_RENDA_AUSENTE,
    pacote: null,
    tres_vezes_pacote: null,
    abaixo_de_3x: null,
  };
}

/**
 * Aceita o bloco que o motor (ou um teste) já calculou.
 * Se `comprovada` vier vazia, fica nula — a declarada nunca preenche o buraco.
 */
export function aceitarBlocoDeRenda(bruto: unknown): BlocoDeRendaCalculado {
  if (bruto == null || typeof bruto !== "object") return blocoDeRendaAusente();
  const o = bruto as Record<string, unknown>;
  const declarada = numero(o.declarada ?? o.renda_declarada);
  const comprovada = numero(o.comprovada ?? o.renda_comprovada);
  const tabela = texto(o.tabela) ?? texto(o.tabela_mensal);
  const motivo = texto(o.motivo_nao_comprovacao) ?? texto(o.motivo_pendente);
  const pacote = numero(o.pacote);
  const tres = numero(o.tres_vezes_pacote);
  const abaixo = typeof o.abaixo_de_3x === "boolean" ? o.abaixo_de_3x : null;

  if (comprovada === null) {
    return {
      comprovada: null,
      declarada,
      tabela: null,
      motivo_nao_comprovacao: motivo ?? TEXTO_BLOCO_RENDA_AUSENTE,
      pacote,
      tres_vezes_pacote: tres,
      abaixo_de_3x: null,
    };
  }
  return {
    comprovada,
    declarada,
    tabela,
    motivo_nao_comprovacao: null,
    pacote,
    tres_vezes_pacote: tres,
    abaixo_de_3x: abaixo,
  };
}

/** Onde o motor deve gravar o bloco na ficha. Sem o campo, a seção fica pendente. */
export function brutoDoBlocoDeRenda(ficha: unknown): unknown {
  if (!ficha || typeof ficha !== "object") return null;
  const renda = (ficha as Record<string, unknown>).renda;
  if (!renda || typeof renda !== "object") return null;
  const r = renda as Record<string, unknown>;
  return r.bloco_calculado ?? r.extrato ?? null;
}

export function lerBlocoDeRendaSalvo(ficha: unknown): BlocoDeRendaCalculado {
  return aceitarBlocoDeRenda(brutoDoBlocoDeRenda(ficha));
}
