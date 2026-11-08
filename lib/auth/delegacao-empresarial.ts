/**
 * Autorização da leitura DELEGADA (buscar / ler / baixar) para um bot compartilhado.
 *
 * NÃO está ligada a rota, MCP, token nem catálogo. A operação comum do CRM não
 * passa por aqui. Ativação exige aprovação à parte — ver
 * `docs/decisoes/delegacao-analise-inquilinos.md`.
 *
 * Fail closed: qualquer prova ausente recusa. Token de organização, cliente
 * administrative e sessão de canal sem classificação NÃO viram "corporativo".
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
 * Classificação de sessão de canal: sem allowlist, sem coluna, sem default
 * corporativo. Enquanto o produto não decidir a fonte, isto é o provedor.
 */
export function classificacaoDeSessaoNaoDisponivel(): ClassificacaoDeSessaoCanal {
  return "nao_classificada";
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
  conversaAutorizadaParaOUsuario: boolean;
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
  if (!pedido.conversaAutorizadaParaOUsuario) {
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

/** Nomes candidatos. Ausentes do catálogo MCP até aprovação. */
export const FERRAMENTAS_DELEGADAS_PROPOSTAS = [
  "crm_search_corporate_conversations",
  "crm_read_corporate_conversation",
  "crm_download_corporate_attachment",
] as const;
