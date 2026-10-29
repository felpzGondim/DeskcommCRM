export { analisarExtrato, analisarExtratoComIa, blocoDoExtratoParaIa } from "./analisar";
export { detectarAluguelAtual } from "./aluguel-atual";
export {
  classificarLancamento,
  classificarLancamentos,
  CLASSES_EXCLUIDAS_DA_RENDA,
} from "./classificar";
export {
  criarExtratorComModelo,
  precisaExtracaoPorIa,
  SYSTEM_EXTRACAO_LANCAMENTOS,
  type ExtratorDeLancamentos,
} from "./extrair-ia";
export {
  decidirFamiliar,
  familiaresDeConjuge,
  juntarFamiliares,
  SOBRENOMES_FREQUENTES,
  type FamiliarDaFicha,
} from "./familiar";
export { combinarHoleriteEExtrato, rendaLiquidaDeHolerite } from "./holerite";
export { lerLancamentos, lotesDePaginas, pareceExtrato } from "./lancamentos";
export {
  FRASE_PACOTE_AUSENTE,
  leitorSuperlogicaDesligado,
  lerSeguroIncendioNoTexto,
  montarPacote,
  textoDoPacote,
  type LeitorDePacoteSuperlogica,
  type PacoteDoImovel,
} from "./pacote";
export { resumirMeses, resumoVazio, textoDoResumoParaIa } from "./resumo-mensal";
export { conferirSaldo, recadoDeSaldo } from "./saldo";
export type {
  AnaliseDeExtrato,
  ClasseLancamento,
  ConferenciaDeSaldo,
  FamiliarProvavel,
  FonteDaExtracao,
  Lancamento,
  LancamentoClassificado,
  LeituraDeExtrato,
  LinhaMensal,
  MotivoFamiliar,
  MotivoSemRenda,
  RecorrenciaPagador,
  ResumoMensal,
  TitularDoExtrato,
} from "./tipos";
