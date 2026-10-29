/**
 * Contrato do bloco de renda que o relatório 4.5 consome.
 *
 * Quem calcula é `lib/locacao/extrato` (mesmo motor do #31 / 4.1).
 * Este módulo monta o bloco a partir das análises e do pacote
 * (aluguel+condomínio+IPTU+seguro-incêndio, sem fiança). Sem prompt,
 * sem regex de `regras.ts`, sem copiar a declarada para a comprovada.
 */
import { comprovadaDasAnalises } from "@/lib/agent-engine/agent/painel-relatorio-preliminar";
import { montarBlocoDeRendaDasAnalises } from "@/lib/locacao/analise/renda";
import {
  montarPacote,
  type AnaliseDeExtrato,
  type PacoteDoImovel,
} from "@/lib/locacao/extrato";

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

function reaisParaCentavos(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v * 100);
}

function valorDoCampo(campo: unknown): number | null {
  if (campo && typeof campo === "object" && "valor" in campo) {
    return numero((campo as { valor?: unknown }).valor);
  }
  return numero(campo);
}

/** Pacote do #31 a partir da ficha. Seguro-incêndio só entra se já estiver no bloco ou no input. */
export function pacoteDaFicha(ficha: unknown, incendioCentavos: number | null = null): PacoteDoImovel {
  const obj = ficha && typeof ficha === "object" ? (ficha as Record<string, unknown>) : {};
  const imovel = obj.imovel && typeof obj.imovel === "object"
    ? (obj.imovel as Record<string, unknown>)
    : {};
  return montarPacote({
    conversa: {
      aluguelCentavos: reaisParaCentavos(valorDoCampo(imovel.aluguel)),
      condominioCentavos: reaisParaCentavos(valorDoCampo(imovel.condominio)),
      iptuCentavos: reaisParaCentavos(valorDoCampo(imovel.iptu)),
      seguroIncendioCentavos: reaisParaCentavos(valorDoCampo(imovel.seguro_incendio)) ?? incendioCentavos,
    },
  });
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
      tabela,
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

/** Monta o bloco a partir das análises do extrato e do pacote do #31. */
export function montarBlocoDeRendaDoExtrato(
  analises: readonly AnaliseDeExtrato[],
  opcoes: {
    pacote?: PacoteDoImovel | null;
    declarada?: number | null;
    holeriteCentavos?: number | null;
  } = {},
): BlocoDeRendaCalculado {
  return aceitarBlocoDeRenda(
    montarBlocoDeRendaDasAnalises(analises, {
      comprovadaCentavos: comprovadaDasAnalises(analises, opcoes.holeriteCentavos ?? null),
      declarada: opcoes.declarada ?? null,
      pacote: opcoes.pacote ?? null,
    }),
  );
}

/**
 * Preferência: análises + pacote do #31. Sem análises, o bloco que o 4.1
 * gravou em `renda.bloco_calculado` (mesmo motor). Sem os dois, pendente.
 */
export function brutoDoBlocoDeRenda(
  ficha: unknown,
  analises?: readonly AnaliseDeExtrato[],
): unknown {
  const renda = ficha && typeof ficha === "object"
    ? (ficha as Record<string, unknown>).renda
    : null;
  const r = renda && typeof renda === "object" ? (renda as Record<string, unknown>) : {};
  const declarada = numero(
    r.declarada && typeof r.declarada === "object"
      ? (r.declarada as { valor?: unknown }).valor
      : (r.bloco_calculado && typeof r.bloco_calculado === "object"
        ? (r.bloco_calculado as { declarada?: unknown }).declarada
        : null),
  );
  if (analises && analises.length > 0) {
    return montarBlocoDeRendaDoExtrato(analises, {
      pacote: pacoteDaFicha(ficha),
      declarada,
    });
  }
  return r.bloco_calculado ?? null;
}

export function lerBlocoDeRendaSalvo(
  ficha: unknown,
  analises?: readonly AnaliseDeExtrato[],
): BlocoDeRendaCalculado {
  return aceitarBlocoDeRenda(brutoDoBlocoDeRenda(ficha, analises));
}
