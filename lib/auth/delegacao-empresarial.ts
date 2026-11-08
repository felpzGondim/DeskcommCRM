/**
 * Autorização da leitura DELEGADA (buscar / ler / baixar) para um bot compartilhado.
 *
 * NÃO está ligada a rota, MCP, token nem catálogo. A operação comum do CRM não
 * passa por aqui. Ativação exige aprovação à parte — ver
 * `docs/decisoes/delegacao-analise-inquilinos.md`.
 *
 * Alvo D3/D5 (Felipe, 08/11/2026 13:12 São Paulo — preparar, NÃO ativar):
 * buscar/ler/baixar em TODAS as conversas corporativas da org imobiliária.
 * Não é assigned-only nem só o turno. Exclui outras empresas e WhatsApp/sessão
 * pessoal. WhatsApp é fonte dos documentos, não canal da atendente com o bot.
 * Identidade individual + org + sessão corporativa + exclusão pessoal
 * continuam obrigatórios. Desconhecido/erro recusa. Este guarda NÃO concede
 * visibilidade ao vivo.
 *
 * Fail closed: qualquer prova ausente recusa. Token de organização, cliente
 * administrative e sessão de canal sem classificação NÃO viram "corporativo".
 * Boolean do chamador NÃO é integração de auth completa — a superfície com
 * sujeito OAuth está em `delegacao-superficie.ts` e permanece desligada.
 *
 * Efeitos permitidos: só buscar, ler e baixar. Escrever ou enviar recusa.
 * Recusa não devolve metadado do recurso (sem path, preview, URL, corpo).
 */
export const EFEITOS_DELEGADOS = ["buscar", "ler", "baixar"] as const;
export type EfeitoDelegado = (typeof EFEITOS_DELEGADOS)[number];

export const MOTIVOS_RECUSA_DELEGADA = [
  "integracao_nao_ativada",
  "identidade_nao_provada",
  "org_nao_autorizada",
  "conversa_nao_autorizada",
  "contato_pessoal",
  "sessao_pessoal",
  "sessao_nao_classificada",
  "anexo_fora_do_recurso",
  "efeito_nao_permitido",
  "visibilidade_nao_ativada",
  "token_invalido",
  "audiencia_invalida",
  "client_id_ausente",
  "grant_ausente",
  "grant_revogado",
  "grant_expirado",
  "grant_escopo_insuficiente",
  "grant_cliente_divergente",
] as const;
export type MotivoRecusaDelegada = (typeof MOTIVOS_RECUSA_DELEGADA)[number];

export type ClassificacaoDeSessaoCanal = "corporativa" | "pessoal" | "nao_classificada";

export type AtorDelegado =
  | { type: "user"; id: string }
  | { type: "api_token"; id: string }
  | { type: "ai_agent"; id: string }
  | { type: "desconhecido" };

export interface AtivacaoDelegada {
  /** Ligar exige aprovação explícita. Produção deixa falso. */
  ativa: boolean;
  /** Contrato de identidade + sessão corporativa aprovado. Produção deixa falso. */
  contratoAprovado: boolean;
}

/** Estado de fábrica: integração desligada. Não há env var que vire isto. */
export const ATIVACAO_DELEGADA_PADRAO: AtivacaoDelegada = {
  ativa: false,
  contratoAprovado: false,
};

/**
 * Classificação de sessão de canal: sem allowlist de session id, sem coluna,
 * sem default corporativo. Enquanto D2 não tiver fonte, isto é o provedor.
 */
export function classificacaoDeSessaoNaoDisponivel(): ClassificacaoDeSessaoCanal {
  return "nao_classificada";
}

/**
 * D3/D5 — alvo DECIDIDO (preparar, não conceder): todas as conversas
 * corporativas da org imobiliária. Assigned-only e turno-atual não são o alvo.
 */
export const VISIBILIDADE_CONVERSA_ALVO = "todas_conversas_corporativas_da_org" as const;
export type VisibilidadeConversaDelegada = typeof VISIBILIDADE_CONVERSA_ALVO;

/**
 * Entitlement auditável de visibilidade corporativa. Nenhum valor concedido
 * existe neste tipo. Uma string no pedido NÃO é grant. Conceder exige
 * aprovação à parte (não este PR, sem migration, sem RLS alargada).
 */
export const ENTITLEMENTS_VISIBILIDADE_CONCEDIDOS = [] as const;
export type EntitlementVisibilidadeDelegada = "ausente";

export const ENTITLEMENT_VISIBILIDADE_PADRAO: EntitlementVisibilidadeDelegada = "ausente";

function entitlementConcedido(valor: string): boolean {
  return (ENTITLEMENTS_VISIBILIDADE_CONCEDIDOS as readonly string[]).includes(valor);
}

export interface AnexoDelegado {
  conversaIdDoPedido: string;
  conversaIdDoAnexo: string | null;
  processoIdDoPedido?: string | null;
  processoIdDoAnexo?: string | null;
}

export interface PedidoDelegado {
  ativacao: AtivacaoDelegada;
  ator: AtorDelegado;
  /** Cliente administrative (service role) não reproduz RLS individual. */
  clienteEhServiceRole: boolean;
  organizationIdDoAtor: string | null;
  organizationIdDoRecurso: string;
  /** Alvo D3/D5. Não substitui entitlement nem RLS. */
  visibilidadeDaConversa: VisibilidadeConversaDelegada;
  /**
   * Grant auditável. Hoje só `"ausente"`. `true` em outro campo não emite isto.
   */
  entitlementDeVisibilidade: EntitlementVisibilidadeDelegada;
  /**
   * Afirmação do chamador no peneira legado. A superfície OAuth NÃO usa
   * este campo: lê `is_personal` via `avaliarContatoPessoalDaConversa`.
   */
  contatoEhPessoal: boolean;
  classificacaoDaSessao: ClassificacaoDeSessaoCanal;
  efeito: string;
  anexo?: AnexoDelegado | null;
}

export type DecisaoDelegada =
  | { ok: true; efeito: EfeitoDelegado }
  | { ok: false; motivo: MotivoRecusaDelegada };

const EFEITOS = new Set<string>(EFEITOS_DELEGADOS);

function identidadeProvada(pedido: PedidoDelegado): boolean {
  if (pedido.clienteEhServiceRole) return false;
  return pedido.ator.type === "user" && pedido.ator.id.trim().length > 0;
}

function anexoAssociado(anexo: AnexoDelegado): boolean {
  if (!anexo.conversaIdDoAnexo || anexo.conversaIdDoAnexo !== anexo.conversaIdDoPedido) {
    return false;
  }
  if (anexo.processoIdDoPedido) {
    return anexo.processoIdDoAnexo === anexo.processoIdDoPedido;
  }
  return true;
}

export function autorizarDelegacaoEmpresarial(pedido: PedidoDelegado): DecisaoDelegada {
  if (!pedido.ativacao.ativa || !pedido.ativacao.contratoAprovado) {
    return { ok: false, motivo: "integracao_nao_ativada" };
  }
  if (!EFEITOS.has(pedido.efeito)) {
    return { ok: false, motivo: "efeito_nao_permitido" };
  }
  if (!identidadeProvada(pedido)) {
    return { ok: false, motivo: "identidade_nao_provada" };
  }
  if (
    !pedido.organizationIdDoAtor ||
    pedido.organizationIdDoAtor !== pedido.organizationIdDoRecurso
  ) {
    return { ok: false, motivo: "org_nao_autorizada" };
  }
  if (pedido.visibilidadeDaConversa !== VISIBILIDADE_CONVERSA_ALVO) {
    return { ok: false, motivo: "conversa_nao_autorizada" };
  }
  if (pedido.contatoEhPessoal) {
    return { ok: false, motivo: "contato_pessoal" };
  }
  if (pedido.classificacaoDaSessao === "pessoal") {
    return { ok: false, motivo: "sessao_pessoal" };
  }
  if (pedido.classificacaoDaSessao !== "corporativa") {
    return { ok: false, motivo: "sessao_nao_classificada" };
  }
  if (pedido.efeito === "baixar") {
    if (!pedido.anexo || !anexoAssociado(pedido.anexo)) {
      return { ok: false, motivo: "anexo_fora_do_recurso" };
    }
  }
  // Último portão: o alvo D3/D5 está escrito; o grant ao vivo não. Boolean
  // dos campos acima NÃO completa a integração de auth.
  if (!entitlementConcedido(pedido.entitlementDeVisibilidade)) {
    return { ok: false, motivo: "visibilidade_nao_ativada" };
  }
  return { ok: true, efeito: pedido.efeito as EfeitoDelegado };
}

const CHAVES_AUDITORIA = [
  "motivo",
  "efeito",
  "organization_id",
  "conversation_id",
  "message_id",
  "documento_id",
] as const;

export type ReciboAuditoriaDelegada = Partial<Record<(typeof CHAVES_AUDITORIA)[number], string>>;

/**
 * Recibo de auditoria: só ids e motivo. Nunca corpo, preview, telefone, path
 * ou URL assinada. Chaves fora da lista caem fora.
 */
export function reciboAuditoriaDelegada(entrada: Record<string, unknown>): ReciboAuditoriaDelegada {
  const saida: ReciboAuditoriaDelegada = {};
  for (const chave of CHAVES_AUDITORIA) {
    const valor = entrada[chave];
    if (typeof valor === "string" && valor.length > 0) saida[chave] = valor;
  }
  return saida;
}

/**
 * Nomes candidatos (D5): busca/leitura/download corporativos da org.
 * Ausentes de allTools / TOOL_CATALOG até ativação aprovada.
 */
export const FERRAMENTAS_DELEGADAS_PROPOSTAS = [
  "crm_search_corporate_conversations",
  "crm_read_corporate_conversation",
  "crm_download_corporate_attachment",
] as const;
