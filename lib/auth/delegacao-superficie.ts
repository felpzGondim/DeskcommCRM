/**
 * Superfície delegada (buscar / ler / baixar) com sujeito OAuth real.
 *
 * Não inicia OAuth, não emite token, não registra client, não grava grant.
 * A rota HTTP que a importa 404 enquanto `ATIVACAO_DELEGADA_PADRAO` está
 * desligada — este módulo só corre em teste com ativação forçada ou depois
 * de aprovação à parte.
 *
 * Identidade = `verificarSujeitoOAuth` (getUser + claims). Org / efeitos =
 * linha viva em `delegacao_visibilidade_corporativa` do próprio `sub`.
 * Classificação = coluna `channel_sessions.classificacao_empresarial`
 * (NULL/lixo recusa). Contato pessoal = `avaliarContatoPessoalDaConversa`.
 * Boolean do chamador não é prova. Sem fallback para dono/admin/service role.
 */
import {
  ATIVACAO_DELEGADA_PADRAO,
  EFEITOS_DELEGADOS,
  reciboAuditoriaDelegada,
  type AtivacaoDelegada,
  type ClassificacaoDeSessaoCanal,
  type EfeitoDelegado,
  type MotivoRecusaDelegada,
  type ReciboAuditoriaDelegada,
} from "./delegacao-empresarial";
import { avaliarContatoPessoalDaConversa } from "./exclusao-contato-pessoal";
import {
  verificarSujeitoOAuth,
  type LeitorAuthOAuth,
  type SujeitoOAuth,
} from "./delegacao-oauth-sujeito";

export type GrantDelegacaoCorporativa = {
  user_id: string;
  organization_id: string;
  oauth_client_id: string;
  efeitos: readonly string[];
  expires_at: string;
  revoked_at: string | null;
};

export type AnexoDaSuperficie = {
  conversaIdDoPedido: string;
  conversaIdDoAnexo: string | null;
  processoIdDoPedido?: string | null;
  processoIdDoAnexo?: string | null;
};

type ClienteLeitura = { from: (tabela: string) => unknown };

export type DepsSuperficieDelegada = {
  leitorAuth?: LeitorAuthOAuth;
  agora?: Date;
  buscarGrant: (q: {
    userId: string;
    clientId: string;
  }) => Promise<GrantDelegacaoCorporativa | null | "erro">;
  lerClassificacaoDaConversa: (q: {
    client: ClienteLeitura;
    organizationId: string;
    conversationId: string;
  }) => Promise<ClassificacaoDeSessaoCanal | "erro">;
  clientDoUsuario: (accessToken: string) => ClienteLeitura;
  avaliarContato?: typeof avaliarContatoPessoalDaConversa;
  buscar?: () => Promise<unknown>;
  ler?: () => Promise<unknown>;
  baixarAssinar?: () => Promise<unknown>;
  baixarProvedor?: () => Promise<unknown>;
};

export type PedidoSuperficieDelegada = {
  ativacao?: AtivacaoDelegada;
  authorizationHeader: string | null | undefined;
  efeito: string;
  conversationId?: string | null;
  anexo?: AnexoDaSuperficie | null;
};

export type ResultadoSuperficieDelegada =
  | { ok: true; efeito: EfeitoDelegado; dados: unknown; auditoria: ReciboAuditoriaDelegada }
  | { ok: false; motivo: MotivoRecusaDelegada; auditoria: ReciboAuditoriaDelegada };

const EFEITOS = new Set<string>(EFEITOS_DELEGADOS);

function anexoAssociado(anexo: AnexoDaSuperficie): boolean {
  if (!anexo.conversaIdDoAnexo || anexo.conversaIdDoAnexo !== anexo.conversaIdDoPedido) {
    return false;
  }
  if (anexo.processoIdDoPedido) {
    return anexo.processoIdDoAnexo === anexo.processoIdDoPedido;
  }
  return true;
}

function auditoria(
  motivo: string,
  pedido: PedidoSuperficieDelegada,
  extra: { organization_id?: string } = {},
): ReciboAuditoriaDelegada {
  return reciboAuditoriaDelegada({
    motivo,
    efeito: pedido.efeito,
    organization_id: extra.organization_id,
    conversation_id: pedido.conversationId ?? pedido.anexo?.conversaIdDoPedido,
  });
}

function recusa(
  motivo: MotivoRecusaDelegada,
  pedido: PedidoSuperficieDelegada,
  extra: { organization_id?: string } = {},
): ResultadoSuperficieDelegada {
  return { ok: false, motivo, auditoria: auditoria(motivo, pedido, extra) };
}

export function interpretarClassificacaoEmpresarial(valor: unknown): ClassificacaoDeSessaoCanal {
  if (valor === "corporativa") return "corporativa";
  if (valor === "pessoal") return "pessoal";
  return "nao_classificada";
}

function grantVivo(
  grant: GrantDelegacaoCorporativa,
  sujeito: SujeitoOAuth,
  efeito: string,
  agora: Date,
): MotivoRecusaDelegada | null {
  if (grant.user_id !== sujeito.userId) return "identidade_nao_provada";
  if (grant.oauth_client_id !== sujeito.clientId) return "grant_cliente_divergente";
  if (grant.revoked_at) return "grant_revogado";
  const expira = Date.parse(grant.expires_at);
  if (!Number.isFinite(expira) || expira <= agora.getTime()) return "grant_expirado";
  if (!grant.efeitos.includes(efeito)) return "grant_escopo_insuficiente";
  if (!grant.organization_id.trim()) return "org_nao_autorizada";
  return null;
}

export async function executarSuperficieDelegada(
  pedido: PedidoSuperficieDelegada,
  deps: DepsSuperficieDelegada,
): Promise<ResultadoSuperficieDelegada> {
  const ativacao = pedido.ativacao ?? ATIVACAO_DELEGADA_PADRAO;
  if (!ativacao.ativa || !ativacao.contratoAprovado) {
    return recusa("integracao_nao_ativada", pedido);
  }
  if (!EFEITOS.has(pedido.efeito)) {
    return recusa("efeito_nao_permitido", pedido);
  }
  if ((pedido.efeito === "ler" || pedido.efeito === "baixar") && !pedido.conversationId) {
    return recusa("conversa_nao_autorizada", pedido);
  }

  const sujeito = await verificarSujeitoOAuth(pedido.authorizationHeader, {
    leitor: deps.leitorAuth,
    agora: deps.agora,
  });
  if (!sujeito.ok) {
    return recusa(sujeito.motivo, pedido);
  }

  let grant: GrantDelegacaoCorporativa | null | "erro";
  try {
    grant = await deps.buscarGrant({
      userId: sujeito.sujeito.userId,
      clientId: sujeito.sujeito.clientId,
    });
  } catch {
    return recusa("grant_ausente", pedido);
  }
  if (grant === "erro" || !grant) return recusa("grant_ausente", pedido);
  const motivoGrant = grantVivo(grant, sujeito.sujeito, pedido.efeito, deps.agora ?? new Date());
  if (motivoGrant) return recusa(motivoGrant, pedido, { organization_id: grant.organization_id });

  const client = deps.clientDoUsuario(sujeito.sujeito.accessToken);
  const avaliar = deps.avaliarContato ?? avaliarContatoPessoalDaConversa;

  if (pedido.efeito === "buscar") {
    const dados = deps.buscar ? await deps.buscar() : [];
    return {
      ok: true,
      efeito: "buscar",
      dados,
      auditoria: auditoria("ok", pedido, { organization_id: grant.organization_id }),
    };
  }

  const conversationId = pedido.conversationId as string;
  const classificacao = await deps.lerClassificacaoDaConversa({
    client,
    organizationId: grant.organization_id,
    conversationId,
  });
  if (classificacao === "erro" || classificacao === "nao_classificada") {
    return recusa("sessao_nao_classificada", pedido, { organization_id: grant.organization_id });
  }
  if (classificacao === "pessoal") {
    return recusa("sessao_pessoal", pedido, { organization_id: grant.organization_id });
  }

  const pessoal = await avaliar(client, grant.organization_id, conversationId);
  if (pessoal.recusar) {
    return recusa(
      pessoal.motivo === "contato_pessoal" ? "contato_pessoal" : "conversa_nao_autorizada",
      pedido,
      { organization_id: grant.organization_id },
    );
  }

  if (pedido.efeito === "baixar") {
    if (!pedido.anexo || !anexoAssociado(pedido.anexo)) {
      return recusa("anexo_fora_do_recurso", pedido, { organization_id: grant.organization_id });
    }
  }

  if (pedido.efeito === "ler") {
    const dados = deps.ler ? await deps.ler() : null;
    return {
      ok: true,
      efeito: "ler",
      dados,
      auditoria: auditoria("ok", pedido, { organization_id: grant.organization_id }),
    };
  }

  const dados = deps.baixarAssinar
    ? await deps.baixarAssinar()
    : deps.baixarProvedor
      ? await deps.baixarProvedor()
      : null;
  return {
    ok: true,
    efeito: "baixar",
    dados,
    auditoria: auditoria("ok", pedido, { organization_id: grant.organization_id }),
  };
}

type Cadeia = {
  select: (cols: string) => Cadeia;
  eq: (coluna: string, valor: string) => Cadeia;
  maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
};

function cadeia(origem: unknown): Cadeia {
  return origem as Cadeia;
}

export async function lerClassificacaoDaConversaViaClient(q: {
  client: ClienteLeitura;
  organizationId: string;
  conversationId: string;
}): Promise<ClassificacaoDeSessaoCanal | "erro"> {
  if (!q.organizationId.trim() || !q.conversationId.trim()) return "erro";
  const conv = await cadeia(q.client.from("conversations"))
    .select("channel_session_id")
    .eq("id", q.conversationId)
    .eq("organization_id", q.organizationId)
    .maybeSingle();
  if (conv.error) return "erro";
  const sessId =
    conv.data && typeof conv.data === "object" && "channel_session_id" in conv.data
      ? (conv.data as { channel_session_id?: unknown }).channel_session_id
      : null;
  if (typeof sessId !== "string" || !sessId.trim()) return "nao_classificada";
  const sess = await cadeia(q.client.from("channel_sessions"))
    .select("classificacao_empresarial")
    .eq("id", sessId)
    .eq("organization_id", q.organizationId)
    .maybeSingle();
  if (sess.error) return "erro";
  const marca =
    sess.data && typeof sess.data === "object" && "classificacao_empresarial" in sess.data
      ? (sess.data as { classificacao_empresarial?: unknown }).classificacao_empresarial
      : null;
  return interpretarClassificacaoEmpresarial(marca);
}
