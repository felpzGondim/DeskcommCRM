/**
 * Conferência: saldo inicial + créditos − débitos = saldo final.
 * Tolerância de 1 centavo. Sem saldos no texto, não afirma que fechou nem
 * que faltou página.
 */
import type { ConferenciaDeSaldo, Lancamento, PeriodoDoExtrato } from "./tipos";

export function conferirSaldo(
  lancamentos: readonly Lancamento[],
  opcoes: {
    saldoAnteriorCentavos?: number | null;
    periodo?: PeriodoDoExtrato;
  } = {},
): ConferenciaDeSaldo {
  const periodo = opcoes.periodo ?? { inicio: null, fim: null };
  let creditos = 0;
  let debitos = 0;
  for (const l of lancamentos) {
    if (l.direcao === "C") creditos += l.valorCentavos;
    else debitos += l.valorCentavos;
  }

  let inicial = opcoes.saldoAnteriorCentavos ?? null;
  const primeiro = lancamentos[0];
  if (inicial == null && primeiro?.saldoCentavos != null) {
    const delta = primeiro.direcao === "C" ? primeiro.valorCentavos : -primeiro.valorCentavos;
    inicial = primeiro.saldoCentavos - delta;
  }
  const comSaldo = [...lancamentos].reverse().find((l) => l.saldoCentavos != null);
  const final = comSaldo?.saldoCentavos ?? null;

  if (inicial == null || final == null) {
    return {
      conferido: false,
      fecha: true,
      diferencaCentavos: 0,
      saldoInicialCentavos: inicial,
      saldoFinalCentavos: final,
      creditosCentavos: creditos,
      debitosCentavos: debitos,
      periodo,
    };
  }

  const esperado = inicial + creditos - debitos;
  const diferenca = final - esperado;
  return {
    conferido: true,
    fecha: Math.abs(diferenca) <= 1,
    diferencaCentavos: diferenca,
    saldoInicialCentavos: inicial,
    saldoFinalCentavos: final,
    creditosCentavos: creditos,
    debitosCentavos: debitos,
    periodo,
  };
}

export function recadoDeSaldo(
  conferencia: ConferenciaDeSaldo,
  nome: string | null,
): string | null {
  if (!conferencia.conferido || conferencia.fecha) return null;
  const periodo =
    conferencia.periodo.inicio && conferencia.periodo.fim
      ? `${conferencia.periodo.inicio} a ${conferencia.periodo.fim}`
      : "período do extrato";
  const origem = nome ? `Extrato ${nome}` : "Extrato";
  const sinal = conferencia.diferencaCentavos > 0 ? "+" : "";
  const reais = (conferencia.diferencaCentavos / 100).toFixed(2).replace(".", ",");
  return `${origem} (${periodo}): saldo não fechou (inicial + créditos − débitos). Diferença ${sinal}R$ ${reais}.`;
}
