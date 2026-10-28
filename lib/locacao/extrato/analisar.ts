/**
 * Fachada reutilizável: texto do PDF → tabela mensal e renda comprovada.
 * Usada pelo relatório preliminar e, depois, pela análise 4.1 e pelo 4.5.
 */
import { classificarLancamentos } from "./classificar";
import { lerLancamentos, pareceExtrato } from "./lancamentos";
import { resumirMeses, textoDoResumoParaIa } from "./resumo-mensal";
import type { AnaliseDeExtrato, MotivoSemRenda } from "./tipos";

const FRASE_ILEGIVEL =
  "Extrato sem lançamentos legíveis (escaneado ou ilegível). Não estime a renda.";
const FRASE_ESCANEADO = "PDF escaneado sem lançamentos legíveis. Não estime a renda.";

export function analisarExtrato(
  texto: string,
  opcoes: {
    paginasPdf?: number | null;
    nomeArquivo?: string | null;
    fonteId?: string | null;
    messageId?: string | null;
    escaneado?: boolean;
  } = {},
): AnaliseDeExtrato {
  const leitura = lerLancamentos(texto, {
    paginasPdf: opcoes.paginasPdf,
    nomeArquivo: opcoes.nomeArquivo,
  });
  const eh = leitura.pareceExtrato || pareceExtrato(texto, opcoes.nomeArquivo);

  if (!eh && leitura.lancamentos.length === 0) {
    return vazio({
      ehExtrato: false,
      motivo: "nao_e_extrato",
      paginasPdf: opcoes.paginasPdf ?? null,
      fonteId: opcoes.fonteId ?? null,
      messageId: opcoes.messageId ?? null,
      nomeArquivo: opcoes.nomeArquivo ?? null,
    });
  }

  if (leitura.lancamentos.length === 0) {
    const motivo: MotivoSemRenda = opcoes.escaneado ? "escaneado" : "ilegivel";
    return {
      ehExtrato: true,
      layout: leitura.layout,
      lancamentos: 0,
      paginasPdf: opcoes.paginasPdf ?? leitura.paginasDeclaradas,
      paginasFaltando: leitura.paginasFaltando,
      resumo: {
        linhas: [],
        rendaComprovadaCentavos: null,
        motivoSemRenda: motivo,
        avisos: [opcoes.escaneado ? FRASE_ESCANEADO : FRASE_ILEGIVEL],
      },
      rendaComprovadaCentavos: null,
      motivoSemRenda: motivo,
      periodo: leitura.periodo,
      avisos: [opcoes.escaneado ? FRASE_ESCANEADO : FRASE_ILEGIVEL],
      fonteId: opcoes.fonteId ?? null,
      messageId: opcoes.messageId ?? null,
      nomeArquivo: opcoes.nomeArquivo ?? null,
    };
  }

  const classificados = classificarLancamentos(leitura.lancamentos, leitura.titular);
  const resumo = resumirMeses(classificados, {
    periodo: leitura.periodo,
    paginasFaltando: leitura.paginasFaltando,
  });
  const avisos = [...new Set([...leitura.avisos, ...resumo.avisos])];

  return {
    ehExtrato: true,
    layout: leitura.layout,
    lancamentos: leitura.lancamentos.length,
    paginasPdf: opcoes.paginasPdf ?? leitura.paginasDeclaradas,
    paginasFaltando: leitura.paginasFaltando,
    resumo,
    rendaComprovadaCentavos: resumo.rendaComprovadaCentavos,
    motivoSemRenda: resumo.motivoSemRenda,
    periodo: leitura.periodo,
    avisos,
    fonteId: opcoes.fonteId ?? null,
    messageId: opcoes.messageId ?? null,
    nomeArquivo: opcoes.nomeArquivo ?? null,
  };
}

export function blocoDoExtratoParaIa(analise: AnaliseDeExtrato): string {
  if (!analise.ehExtrato) return "";
  if (analise.lancamentos === 0) {
    return analise.avisos[0] ?? "Extrato sem lançamentos legíveis. Não estime a renda.";
  }
  return textoDoResumoParaIa(analise.resumo, analise.paginasPdf);
}

function vazio(p: {
  ehExtrato: boolean;
  motivo: MotivoSemRenda;
  paginasPdf: number | null;
  fonteId: string | null;
  messageId: string | null;
  nomeArquivo: string | null;
}): AnaliseDeExtrato {
  return {
    ehExtrato: p.ehExtrato,
    layout: "desconhecido",
    lancamentos: 0,
    paginasPdf: p.paginasPdf,
    paginasFaltando: false,
    resumo: { linhas: [], rendaComprovadaCentavos: null, motivoSemRenda: p.motivo, avisos: [] },
    rendaComprovadaCentavos: null,
    motivoSemRenda: p.motivo,
    periodo: { inicio: null, fim: null },
    avisos: [],
    fonteId: p.fonteId,
    messageId: p.messageId,
    nomeArquivo: p.nomeArquivo,
  };
}
