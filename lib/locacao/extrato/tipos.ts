/**
 * Tipos do leitor de extrato bancário. Reuso: relatório preliminar, análise
 * de renda 4.1 e relatório 4.5. Sem I/O; nunca loga CPF/telefone/e-mail/RG.
 */

export type DirecaoLancamento = "C" | "D";

export type ClasseLancamento =
  | "propria"
  | "resgate_aplicacao"
  | "estorno_devolucao"
  | "emprestimo"
  | "venda_cartao"
  | "salario_prolabore"
  | "terceiro_pj"
  | "terceiro_pf"
  | "saida"
  | "outro";

export type CoberturaDoMes = "completo" | "parcial" | "incompleto_pagina";

export type MotivoSemRenda =
  "ilegivel" | "escaneado" | "so_negocio" | "pagina_faltando" | "nao_e_extrato";

export interface TitularDoExtrato {
  nome: string | null;
  cpfDigits: string | null;
}

export interface Lancamento {
  data: string;
  descricao: string;
  valorCentavos: number;
  direcao: DirecaoLancamento;
  saldoCentavos: number | null;
  pagina: number | null;
  contraparte: string | null;
}

export interface LancamentoClassificado extends Lancamento {
  classe: ClasseLancamento;
}

export interface PeriodoDoExtrato {
  inicio: string | null;
  fim: string | null;
}

export interface LeituraDeExtrato {
  pareceExtrato: boolean;
  layout: "stone" | "generico" | "desconhecido";
  titular: TitularDoExtrato;
  periodo: PeriodoDoExtrato;
  paginasDeclaradas: number | null;
  paginasVistas: number;
  paginasFaltando: boolean;
  lancamentos: Lancamento[];
  avisos: string[];
}

export interface PagadorRecorrente {
  mascara: string;
  meses: number;
  totalCentavos: number;
}

export interface LinhaMensal {
  mes: string;
  creditosBrutosCentavos: number;
  excluidos: Partial<Record<ClasseLancamento, number>>;
  rendaConsideradaCentavos: number;
  saidasCentavos: number;
  cobertura: CoberturaDoMes;
  pagadoresRecorrentes: PagadorRecorrente[];
}

export interface ResumoMensal {
  linhas: LinhaMensal[];
  rendaComprovadaCentavos: number | null;
  motivoSemRenda: MotivoSemRenda | null;
  avisos: string[];
}

export interface AnaliseDeExtrato {
  ehExtrato: boolean;
  layout: LeituraDeExtrato["layout"];
  lancamentos: number;
  paginasPdf: number | null;
  paginasFaltando: boolean;
  resumo: ResumoMensal;
  rendaComprovadaCentavos: number | null;
  motivoSemRenda: MotivoSemRenda | null;
  periodo: PeriodoDoExtrato;
  avisos: string[];
  fonteId: string | null;
  messageId: string | null;
  nomeArquivo: string | null;
}
