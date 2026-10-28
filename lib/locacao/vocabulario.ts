/**
 * Vocabulário das tabelas de locação (Fases 3, 3.5 e 3b). Cada tupla casa com
 * o CHECK do banco — o invariante `vocabulario-banco-x-typescript` aponta para
 * estes símbolos, nunca para uma cópia dos valores.
 *
 * Sem dado pessoal. Sem string solta nas rotas: use estas constantes.
 */

export const PAPEIS_DO_PROCESSO = ["locatario", "solidario", "fiador", "contato"] as const;
export type PapelDoProcesso = (typeof PAPEIS_DO_PROCESSO)[number];

export const RELACOES_DE_CONTATO_DO_PROCESSO = [
  "parente",
  "corretor",
  "conjuge",
  "empresa",
  "outro",
] as const;
export type RelacaoDeContatoDoProcesso = (typeof RELACOES_DE_CONTATO_DO_PROCESSO)[number];

export const STATUS_DO_PROCESSO = [
  "lead",
  "documentos",
  "analise",
  "aprovado",
  "reprovado",
  "contrato_preparado",
  "contrato_criado",
  "contrato_assinado",
  "cancelado",
] as const;
export type StatusDoProcesso = (typeof STATUS_DO_PROCESSO)[number];

export const MOTIVOS_DE_CANCELAMENTO = [
  "desistencia",
  "alugado_outro",
  "expirado",
  "outro",
] as const;
export type MotivoDeCancelamento = (typeof MOTIVOS_DE_CANCELAMENTO)[number];

export const TIPOS_DE_IMOVEL_DO_PROCESSO = ["residencial", "comercial"] as const;
export type TipoDeImovelDoProcesso = (typeof TIPOS_DE_IMOVEL_DO_PROCESSO)[number];

export const ORIGENS_DO_VINCULO_SUPERLOGICA = [
  "manual",
  "contrato_confirmar",
  "casamento_telefone",
] as const;
export type OrigemDoVinculoSuperlogica = (typeof ORIGENS_DO_VINCULO_SUPERLOGICA)[number];

export const MOTIVOS_DE_DESFAZER_VINCULO = [
  "errado",
  "numero_mudou",
  "lgpd",
  "outro",
] as const;
export type MotivoDeDesfazerVinculo = (typeof MOTIVOS_DE_DESFAZER_VINCULO)[number];

export const QUALIDADES_DO_VINCULO = ["exato", "sem_9", "ddd_presumido"] as const;
export type QualidadeDoVinculo = (typeof QUALIDADES_DO_VINCULO)[number];

export const ORIGENS_DA_CONVERSA_DO_PROCESSO = ["criacao", "manual", "sugestao"] as const;
export type OrigemDaConversaDoProcesso = (typeof ORIGENS_DA_CONVERSA_DO_PROCESSO)[number];

export const ORIGENS_DA_FICHA_DO_PROCESSO = [
  "preliminar_ia",
  "atendente",
  "hub_fc",
  "hub_migra",
  "contrato",
  "lgpd",
] as const;
export type OrigemDaFichaDoProcesso = (typeof ORIGENS_DA_FICHA_DO_PROCESSO)[number];

export const TIPOS_DE_EVENTO_DO_PROCESSO = [
  "status",
  "participante",
  "ficha",
  "analise_fc",
  "migra",
  "contrato_preparar",
  "contrato_confirmar",
  "documento",
  "lgpd",
] as const;
export type TipoDeEventoDoProcesso = (typeof TIPOS_DE_EVENTO_DO_PROCESSO)[number];

export const ATORES_DO_EVENTO = ["usuario", "sistema", "hub"] as const;
export type AtorDoEvento = (typeof ATORES_DO_EVENTO)[number];

export const ESTADOS_DA_ANALISE_FC = [
  "solicitada",
  "aguardando_cobranca",
  "cobrando",
  "concluida",
  "reaproveitada",
  "erro",
  "cancelada",
] as const;
export type EstadoDaAnaliseFc = (typeof ESTADOS_DA_ANALISE_FC)[number];

export const MODOS_DA_EXECUCAO_DE_VINCULO = ["simulacao", "valendo"] as const;
export type ModoDaExecucaoDeVinculo = (typeof MODOS_DA_EXECUCAO_DE_VINCULO)[number];

export const ESTADOS_DA_EXECUCAO_DE_VINCULO = [
  "rodando",
  "concluida",
  "erro",
  "cancelada",
] as const;
export type EstadoDaExecucaoDeVinculo = (typeof ESTADOS_DA_EXECUCAO_DE_VINCULO)[number];

export const ESTADOS_DA_REVISAO_DE_VINCULO = [
  "pendente",
  "ligado",
  "nao_ligar",
  "expirado",
] as const;
export type EstadoDaRevisaoDeVinculo = (typeof ESTADOS_DA_REVISAO_DE_VINCULO)[number];

export const CATEGORIAS_DE_DOCUMENTO = [
  "documento_pessoal",
  "comprovante_renda",
  "laudo_fc",
  "cotacao_seguro",
  "relatorio",
  "contrato",
  "outro",
] as const;
export type CategoriaDeDocumento = (typeof CATEGORIAS_DE_DOCUMENTO)[number];

export const ORIGENS_DO_DOCUMENTO = [
  "anexo_conversa",
  "upload_manual",
  "hub_fc",
  "hub_migra",
  "relatorio",
] as const;
export type OrigemDoDocumento = (typeof ORIGENS_DO_DOCUMENTO)[number];

export const ESTADOS_DO_DRIVE = [
  "nao_se_aplica",
  "pendente",
  "copiado",
  "falhou",
] as const;
export type EstadoDoDrive = (typeof ESTADOS_DO_DRIVE)[number];

export const ESTADOS_DA_VPS = ["nao_se_aplica", "pendente", "copiado", "falhou"] as const;
export type EstadoDaVps = (typeof ESTADOS_DA_VPS)[number];

export const CATEGORIAS_DE_CASAMENTO = [
  "unico_exato",
  "unico_parcial",
  "varias_pessoas_um_numero",
  "uma_pessoa_varios_contatos",
  "ja_vinculado_igual",
  "ja_vinculado_diferente",
  "numero_mudou",
  "sem_casamento",
  "fora",
] as const;
export type CategoriaDeCasamento = (typeof CATEGORIAS_DE_CASAMENTO)[number];

export const STATUS_FINAIS_DO_PROCESSO: readonly StatusDoProcesso[] = [
  "contrato_assinado",
  "reprovado",
  "cancelado",
];

export function ehStatusDoProcesso(valor: string): valor is StatusDoProcesso {
  return (STATUS_DO_PROCESSO as readonly string[]).includes(valor);
}

export function ehPapelDoProcesso(valor: string): valor is PapelDoProcesso {
  return (PAPEIS_DO_PROCESSO as readonly string[]).includes(valor);
}
