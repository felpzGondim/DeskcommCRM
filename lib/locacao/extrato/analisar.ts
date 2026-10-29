/**
 * Fachada reutilizável: texto do PDF → tabela mensal e renda comprovada.
 * Parser determinístico primeiro; IA só se o layout não for reconhecido ou
 * o saldo não fechar. Usada pelo relatório preliminar, análise 4.1 e 4.5.
 */
import { classificarLancamentos } from "./classificar";
import { juntarFamiliares, type FamiliarDaFicha } from "./familiar";
import {
  normalizarResultadoExtrator,
  precisaExtracaoPorIa,
  type ExtratorDeLancamentos,
} from "./extrair-ia";
import { lerLancamentos, pareceExtrato } from "./lancamentos";
import { conferirSaldo, recadoDeSaldo } from "./saldo";
import { resumirMeses, resumoVazio, textoDoResumoParaIa } from "./resumo-mensal";
import type {
  AnaliseDeExtrato,
  ConferenciaDeSaldo,
  FonteDaExtracao,
  Lancamento,
  MotivoSemRenda,
  TitularDoExtrato,
} from "./tipos";

const FRASE_ILEGIVEL =
  "Extrato sem lançamentos legíveis (escaneado ou ilegível). Não estime a renda.";
const FRASE_ESCANEADO = "PDF escaneado sem lançamentos legíveis. Não estime a renda.";
export const FRASE_SALDO_NAO_FECHOU_CONFERIR = "saldo não fechou, conferir";

function avisosUnicos(avisos: readonly string[]): string[] {
  return [...new Set(avisos.filter((a) => a.trim().length > 0))];
}

const CONFERENCIA_VAZIA: ConferenciaDeSaldo = {
  conferido: false,
  fecha: true,
  diferencaCentavos: 0,
  saldoInicialCentavos: null,
  saldoFinalCentavos: null,
  creditosCentavos: 0,
  debitosCentavos: 0,
  periodo: { inicio: null, fim: null },
};

function fecharAnalise(input: {
  ehExtrato: boolean;
  layout: AnaliseDeExtrato["layout"];
  fonteExtracao: FonteDaExtracao;
  lancamentos: Lancamento[];
  titular: TitularDoExtrato;
  paginasPdf: number | null;
  paginasFaltando: boolean;
  conferencia: ConferenciaDeSaldo;
  periodo: { inicio: string | null; fim: string | null };
  avisos: string[];
  fonteId: string | null;
  messageId: string | null;
  nomeArquivo: string | null;
  conjuge?: TitularDoExtrato | null;
  familiares?: readonly FamiliarDaFicha[];
  motivoVazio?: MotivoSemRenda;
}): AnaliseDeExtrato {
  if (input.lancamentos.length === 0) {
    const motivo = input.motivoVazio ?? "ilegivel";
    const avisos = input.avisos.length > 0 ? input.avisos : [FRASE_ILEGIVEL];
    return {
      ehExtrato: input.ehExtrato,
      layout: input.layout,
      fonteExtracao: input.fonteExtracao,
      lancamentos: 0,
      itens: [],
      titular: input.titular,
      paginasPdf: input.paginasPdf,
      paginasFaltando: input.paginasFaltando,
      conferencia: input.conferencia,
      resumo: resumoVazio(motivo, avisos),
      rendaComprovadaCentavos: null,
      motivoSemRenda: motivo,
      periodo: input.periodo,
      avisos,
      fonteId: input.fonteId,
      messageId: input.messageId,
      nomeArquivo: input.nomeArquivo,
    };
  }

  const classificados = classificarLancamentos(
    input.lancamentos,
    input.titular,
    juntarFamiliares(input.familiares, input.conjuge),
  );
  const resumo = resumirMeses(classificados, {
    periodo: input.periodo,
    paginasFaltando: input.paginasFaltando,
  });
  const avisos = [...new Set([...input.avisos, ...resumo.avisos])];
  const saldoRecado = recadoDeSaldo(input.conferencia, input.nomeArquivo);
  if (saldoRecado) avisos.unshift(saldoRecado);

  return {
    ehExtrato: true,
    layout: input.layout,
    fonteExtracao: input.fonteExtracao,
    lancamentos: input.lancamentos.length,
    itens: classificados,
    titular: input.titular,
    paginasPdf: input.paginasPdf,
    paginasFaltando: input.paginasFaltando,
    conferencia: input.conferencia,
    resumo,
    rendaComprovadaCentavos: resumo.rendaComprovadaCentavos,
    motivoSemRenda: resumo.motivoSemRenda,
    periodo: input.periodo,
    avisos,
    fonteId: input.fonteId,
    messageId: input.messageId,
    nomeArquivo: input.nomeArquivo,
  };
}

export function analisarExtrato(
  texto: string,
  opcoes: {
    paginasPdf?: number | null;
    nomeArquivo?: string | null;
    fonteId?: string | null;
    messageId?: string | null;
    escaneado?: boolean;
    conjuge?: TitularDoExtrato | null;
    familiares?: readonly FamiliarDaFicha[];
  } = {},
): AnaliseDeExtrato {
  const leitura = lerLancamentos(texto, {
    paginasPdf: opcoes.paginasPdf,
    nomeArquivo: opcoes.nomeArquivo,
  });
  const eh = leitura.pareceExtrato || pareceExtrato(texto, opcoes.nomeArquivo);

  if (!eh && leitura.lancamentos.length === 0) {
    return fecharAnalise({
      ehExtrato: false,
      layout: "desconhecido",
      fonteExtracao: "parser",
      lancamentos: [],
      titular: leitura.titular,
      paginasPdf: opcoes.paginasPdf ?? null,
      paginasFaltando: false,
      conferencia: CONFERENCIA_VAZIA,
      periodo: { inicio: null, fim: null },
      avisos: [],
      fonteId: opcoes.fonteId ?? null,
      messageId: opcoes.messageId ?? null,
      nomeArquivo: opcoes.nomeArquivo ?? null,
      motivoVazio: "nao_e_extrato",
    });
  }

  if (leitura.lancamentos.length === 0) {
    const motivo: MotivoSemRenda = opcoes.escaneado ? "escaneado" : "ilegivel";
    return fecharAnalise({
      ehExtrato: true,
      layout: leitura.layout,
      fonteExtracao: "parser",
      lancamentos: [],
      titular: leitura.titular,
      paginasPdf: opcoes.paginasPdf ?? leitura.paginasDeclaradas,
      paginasFaltando: leitura.paginasFaltando,
      conferencia: leitura.conferencia,
      periodo: leitura.periodo,
      avisos: [opcoes.escaneado ? FRASE_ESCANEADO : FRASE_ILEGIVEL],
      fonteId: opcoes.fonteId ?? null,
      messageId: opcoes.messageId ?? null,
      nomeArquivo: opcoes.nomeArquivo ?? null,
      motivoVazio: motivo,
    });
  }

  return fecharAnalise({
    ehExtrato: true,
    layout: leitura.layout,
    fonteExtracao: "parser",
    lancamentos: leitura.lancamentos,
    titular: leitura.titular,
    paginasPdf: opcoes.paginasPdf ?? leitura.paginasDeclaradas,
    paginasFaltando: leitura.paginasFaltando,
    conferencia: leitura.conferencia,
    periodo: leitura.periodo,
    avisos: [...leitura.avisos],
    fonteId: opcoes.fonteId ?? null,
    messageId: opcoes.messageId ?? null,
    nomeArquivo: opcoes.nomeArquivo ?? null,
    conjuge: opcoes.conjuge,
    familiares: opcoes.familiares,
  });
}

export async function analisarExtratoComIa(
  texto: string,
  opcoes: {
    paginasPdf?: number | null;
    nomeArquivo?: string | null;
    fonteId?: string | null;
    messageId?: string | null;
    escaneado?: boolean;
    conjuge?: TitularDoExtrato | null;
    familiares?: readonly FamiliarDaFicha[];
    extrator?: ExtratorDeLancamentos;
  } = {},
): Promise<AnaliseDeExtrato> {
  const parser = analisarExtrato(texto, opcoes);
  const leitura = lerLancamentos(texto, {
    paginasPdf: opcoes.paginasPdf,
    nomeArquivo: opcoes.nomeArquivo,
  });
  if (
    !opcoes.extrator ||
    !precisaExtracaoPorIa({
      layout: leitura.layout,
      lancamentos: leitura.lancamentos.length,
      paginasFaltando: leitura.paginasFaltando,
      saldoFecha: !leitura.conferencia.conferido || leitura.conferencia.fecha,
      escaneado: opcoes.escaneado === true,
      pareceExtrato: leitura.pareceExtrato || pareceExtrato(texto, opcoes.nomeArquivo),
    })
  ) {
    return parser;
  }

  let extraido: ReturnType<typeof normalizarResultadoExtrator>;
  try {
    extraido = normalizarResultadoExtrator(
      await opcoes.extrator({ texto, nomeArquivo: opcoes.nomeArquivo }),
    );
  } catch {
    return {
      ...parser,
      avisos: avisosUnicos([...parser.avisos, FRASE_SALDO_NAO_FECHOU_CONFERIR]),
    };
  }

  const daIa = extraido.lancamentos;
  if (daIa.length === 0) {
    return {
      ...parser,
      avisos: avisosUnicos([
        ...parser.avisos,
        ...extraido.pendencias,
        FRASE_SALDO_NAO_FECHOU_CONFERIR,
      ]),
    };
  }

  const conferenciaIa = conferirSaldo(daIa, {
    saldoAnteriorCentavos: leitura.saldoAnteriorCentavos,
    periodo: leitura.periodo,
  });
  const saldoFecha = !conferenciaIa.conferido || conferenciaIa.fecha;
  if (parser.lancamentos > 0 && !saldoFecha && parser.conferencia.fecha) {
    return {
      ...parser,
      avisos: avisosUnicos([...parser.avisos, ...extraido.pendencias]),
    };
  }
  const usarIa = parser.lancamentos === 0 || saldoFecha || !parser.conferencia.fecha;

  if (!usarIa) {
    return {
      ...parser,
      avisos: avisosUnicos([...parser.avisos, ...extraido.pendencias]),
    };
  }

  return fecharAnalise({
    ehExtrato: true,
    layout: leitura.layout === "desconhecido" ? "generico" : leitura.layout,
    fonteExtracao: "ia",
    lancamentos: daIa,
    titular: leitura.titular,
    paginasPdf: opcoes.paginasPdf ?? leitura.paginasDeclaradas,
    paginasFaltando:
      extraido.pendencias.length > 0 || (conferenciaIa.conferido && !conferenciaIa.fecha),
    conferencia: conferenciaIa,
    periodo: leitura.periodo,
    avisos: extraido.pendencias,
    fonteId: opcoes.fonteId ?? null,
    messageId: opcoes.messageId ?? null,
    nomeArquivo: opcoes.nomeArquivo ?? null,
    conjuge: opcoes.conjuge,
    familiares: opcoes.familiares,
  });
}

export function blocoDoExtratoParaIa(analise: AnaliseDeExtrato): string {
  if (!analise.ehExtrato) return "";
  const origem = `Fonte da extração: ${analise.fonteExtracao === "ia" ? "IA" : "parser"}.`;
  if (analise.lancamentos === 0) {
    return `${origem} ${analise.avisos[0] ?? "Extrato sem lançamentos legíveis. Não estime a renda."}`;
  }
  return `${origem}\n${textoDoResumoParaIa(analise.resumo, analise.paginasPdf)}`;
}
