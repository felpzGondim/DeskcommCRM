/**
 * Tipos do leitor de extrato bancário. Reuso: relatório preliminar, análise
 * de renda 4.1 e relatório 4.5. Sem I/O; nunca loga CPF/telefone/e-mail/RG.
 *
 * Renda comprovada (correção 20:57): créditos de terceiros (PIX/TED, inclusive
 * avulsos) + salário/pró-labore + vendas no cartão. Saem: próprias, familiares
 * diretos, resgates/aplicações, estornos e empréstimos. Familiares só por
 * sobrenome/nome parcial saem da comprovada mas entram na renda com prováveis.
 */

export type MotivoFamiliar =
  "ficha" | "cpf_ficha" | "parentesco" | "sobrenome" | "sobrenome_comum" | "nome_parcial";

export type DirecaoLancamento = "C" | "D";

export type ClasseLancamento =
  | "propria"
  | "conjuge"
  | "familiar"
  | "familiar_provavel"
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

export type FonteDaExtracao = "parser" | "ia";

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
  motivoFamiliar?: MotivoFamiliar;
}

export interface PeriodoDoExtrato {
  inicio: string | null;
  fim: string | null;
}

export interface ConferenciaDeSaldo {
  conferido: boolean;
  fecha: boolean;
  diferencaCentavos: number;
  saldoInicialCentavos: number | null;
  saldoFinalCentavos: number | null;
  creditosCentavos: number;
  debitosCentavos: number;
  periodo: PeriodoDoExtrato;
}

export interface LeituraDeExtrato {
  pareceExtrato: boolean;
  layout: "stone" | "generico" | "desconhecido";
  titular: TitularDoExtrato;
  periodo: PeriodoDoExtrato;
  paginasDeclaradas: number | null;
  paginasVistas: number;
  paginasFaltando: boolean;
  saldoAnteriorCentavos: number | null;
  conferencia: ConferenciaDeSaldo;
  lancamentos: Lancamento[];
  avisos: string[];
}

export interface PagadorRecorrente {
  mascara: string;
  meses: number;
  lancamentos: number;
  totalCentavos: number;
}

export interface RecorrenciaPagador {
  mascara: string;
  meses: string[];
  lancamentos: number;
  totalCentavos: number;
  porMes: { mes: string; lancamentos: number; totalCentavos: number }[];
}

export interface FamiliarProvavel {
  mascara: string;
  totalCentavos: number;
  lancamentos: number;
  motivo: MotivoFamiliar;
}

export interface SomaPorFonte {
  mascara: string;
  totalCentavos: number;
}

export interface LinhaMensal {
  mes: string;
  creditosBrutosCentavos: number;
  excluidos: Partial<Record<ClasseLancamento, number>>;
  rendaConsideradaCentavos: number;
  rendaComProvaveisCentavos: number;
  pixTerceirosCentavos: number;
  vendasCartaoCentavos: number;
  saidasCentavos: number;
  cobertura: CoberturaDoMes;
  pagadoresRecorrentes: PagadorRecorrente[];
  entradasPorFonte: SomaPorFonte[];
  saidasPorFonte: SomaPorFonte[];
}

export interface AluguelAtualDetectado {
  encontrado: boolean;
  valorCentavos: number | null;
  meses: number;
  mascara: string | null;
  recado: string;
}

export interface ResumoMensal {
  linhas: LinhaMensal[];
  rendaComprovadaCentavos: number | null;
  rendaComProvaveisCentavos: number | null;
  motivoSemRenda: MotivoSemRenda | null;
  volumePropriasCentavos: number;
  volumeConjugeCentavos: number;
  volumeFamiliarCentavos: number;
  volumeFamiliarProvavelCentavos: number;
  volumePixTerceirosCentavos: number;
  volumeVendasCartaoCentavos: number;
  aluguelAtual: AluguelAtualDetectado;
  despesasFixas: SomaPorFonte[];
  atipicas: SomaPorFonte[];
  recorrenciaPagadores: RecorrenciaPagador[];
  familiaresProvaveis: FamiliarProvavel[];
  avisos: string[];
}

export interface AnaliseDeExtrato {
  ehExtrato: boolean;
  layout: LeituraDeExtrato["layout"];
  fonteExtracao: FonteDaExtracao;
  lancamentos: number;
  itens: LancamentoClassificado[];
  titular: TitularDoExtrato;
  paginasPdf: number | null;
  paginasFaltando: boolean;
  conferencia: ConferenciaDeSaldo;
  resumo: ResumoMensal;
  rendaComprovadaCentavos: number | null;
  motivoSemRenda: MotivoSemRenda | null;
  periodo: PeriodoDoExtrato;
  avisos: string[];
  fonteId: string | null;
  messageId: string | null;
  nomeArquivo: string | null;
}
