/**
 * Padrões de contrato aplicados DEPOIS do preenchimento pela conversa.
 * Só entram em campo ainda vazio — nunca sobrescrevem conversa, manual
 * nem valor já gravado. Origem "padrao". Sem I/O. Sem dado pessoal.
 */
import { MESES_FIM_VIGENCIA, vigenciaManual } from "@/lib/locacao/analise/manual";
import type { CampoFicha, FichaPreliminar, NumeroFicha } from "@/lib/locacao/ficha-schema";

export const FONTE_PADRAO = "padrao";
export const INDICE_REAJUSTE_PADRAO = "IGPM";
export const TAXA_ADM_PADRAO = 5;
/** 100% = um aluguel cheio. */
export const TAXA_LOCACAO_PADRAO = 100;

function campoVazio(c: CampoFicha | NumeroFicha | undefined): boolean {
  if (!c) return true;
  if (c.valor == null) return true;
  if (typeof c.valor === "string" && c.valor.trim() === "") return true;
  return false;
}

function campoPadrao(valor: string): CampoFicha {
  return {
    valor,
    fonte: FONTE_PADRAO,
    trecho: "padrão da locação",
    confianca: 1,
    message_id: null,
  };
}

function numeroPadrao(valor: number): NumeroFicha {
  return {
    valor,
    fonte: FONTE_PADRAO,
    trecho: "padrão da locação",
    confianca: 1,
    message_id: null,
  };
}

function isoMaisMeses(iso: string, meses: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMonth(d.getUTCMonth() + meses);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/**
 * Preenche vigência e taxas só onde ainda está vazio.
 * Início = data do preenchimento + 5 dias; término = início + 30 meses.
 */
export function aplicarPadroesDoContrato(
  ficha: FichaPreliminar,
  hoje: Date = new Date(),
): FichaPreliminar {
  const vigenciaHoje = vigenciaManual(hoje);
  const inicio = campoVazio(ficha.vigencia.inicio)
    ? campoPadrao(vigenciaHoje.inicio)
    : ficha.vigencia.inicio;
  const inicioIso = typeof inicio.valor === "string" ? inicio.valor : vigenciaHoje.inicio;
  const fimCalculado = isoMaisMeses(inicioIso, MESES_FIM_VIGENCIA) ?? vigenciaHoje.fim;
  const fim = campoVazio(ficha.vigencia.fim) ? campoPadrao(fimCalculado) : ficha.vigencia.fim;
  return {
    ...ficha,
    vigencia: {
      ...ficha.vigencia,
      inicio,
      fim,
    },
    contrato: {
      ...ficha.contrato,
      indice_reajuste: campoVazio(ficha.contrato.indice_reajuste)
        ? campoPadrao(INDICE_REAJUSTE_PADRAO)
        : ficha.contrato.indice_reajuste,
      taxa_adm: campoVazio(ficha.contrato.taxa_adm)
        ? numeroPadrao(TAXA_ADM_PADRAO)
        : ficha.contrato.taxa_adm,
      taxa_locacao: campoVazio(ficha.contrato.taxa_locacao)
        ? numeroPadrao(TAXA_LOCACAO_PADRAO)
        : ficha.contrato.taxa_locacao,
    },
  };
}
