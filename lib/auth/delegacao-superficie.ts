/**
 * Superfície delegada (buscar / ler / baixar) para identidade OAuth individual.
 *
 * Canal Bot ≠ fonte WhatsApp. Origem empresarial = vínculo da sessão com a
 * conta empresarial da org (`fn_delegacao_sessao_empresarial`). Grant individual
 * read-only (uid+client+org). Sessão nova/substituída herda se o cadastro da
 * conexão gravar o mesmo conta_id. contacts.is_personal is false NÃO basta:
 * pessoal/desconhecida (sem vínculo) recusa.
 *
 * Não inicia OAuth, não emite token, não registra client, não grava grant.
 * Identidade = `verificarSujeitoOAuth` (role=oauth_delegado). Nunca dsk_/admin
 * como sujeito. Client PostgREST = JWT da pessoa (RLS).
 */
import { createHash } from "node:crypto";

import { avaliarContatoPessoalDaConversa } from "./exclusao-contato-pessoal";
import {
  verificarSujeitoOAuth,
  type LeitorAuthOAuth,
  type MotivoRecusaSujeitoOAuth,
  type SujeitoOAuth,
} from "./delegacao-oauth-sujeito";

export const EFEITOS_DELEGADOS = ["buscar", "ler", "baixar"] as const;
export type EfeitoDelegado = (typeof EFEITOS_DELEGADOS)[number];

export type MotivoRecusaDelegada =
  | MotivoRecusaSujeitoOAuth
  | "efeito_nao_permitido"
  | "grant_ausente"
  | "grant_revogado"
  | "grant_expirado"
  | "grant_cliente_divergente"
  | "grant_escopo_insuficiente"
  | "org_nao_autorizada"
  | "conversa_nao_autorizada"
  | "contato_pessoal"
  | "sessao_nao_empresarial"
  | "anexo_fora_do_recurso";

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
  bucket: string;
  path: string;
};

type Linha = Record<string, unknown>;

type Cadeia = {
  select: (cols: string) => Cadeia;
  eq: (coluna: string, valor: string) => Cadeia;
  in: (coluna: string, valores: string[]) => Cadeia;
  is: (coluna: string, valor: null) => Cadeia;
  limit: (n: number) => Cadeia;
  maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
  then: PromiseLike<{ data: unknown; error: unknown }>["then"];
};

export type ClienteLeitura = {
  from: (tabela: string) => unknown;
  schema?: (nome: string) => { from: (tabela: string) => unknown };
};

export type DepsSuperficieDelegada = {
  leitorAuth?: LeitorAuthOAuth;
  agora?: Date;
  buscarGrant: (q: {
    client: ClienteLeitura;
    userId: string;
    clientId: string;
  }) => Promise<GrantDelegacaoCorporativa | null | "erro">;
  clientDoUsuario: (accessToken: string) => ClienteLeitura;
  assinarAposRls?: (q: {
    bucket: string;
    path: string;
  }) => Promise<{ signed_url: string; expires_in: number } | null>;
};

export type PedidoSuperficieDelegada = {
  authorizationHeader: string | null | undefined;
  efeito: string;
  conversationId?: string | null;
  anexo?: AnexoDaSuperficie | null;
};

export type ReciboAuditoriaDelegada = {
  motivo: string;
  efeito: string;
  organization_id?: string;
  conversation_id?: string;
};

export type ResultadoSuperficieDelegada =
  | { ok: true; efeito: EfeitoDelegado; dados: unknown; auditoria: ReciboAuditoriaDelegada }
  | { ok: false; motivo: MotivoRecusaDelegada; auditoria: ReciboAuditoriaDelegada };

const EFEITOS = new Set<string>(EFEITOS_DELEGADOS);
const COLS_CONVERSA = "id,organization_id,contact_id,channel_session_id,status,updated_at,created_at";
const COLS_MSG =
  "id,conversation_id,organization_id,channel_session_id,type,direction,created_at,media_storage_path,body";

function cadeia(origem: unknown): Cadeia {
  return origem as Cadeia;
}

function auditoria(
  motivo: string,
  pedido: PedidoSuperficieDelegada,
  extra: { organization_id?: string } = {},
): ReciboAuditoriaDelegada {
  return {
    motivo,
    efeito: pedido.efeito,
    organization_id: extra.organization_id,
    conversation_id: pedido.conversationId ?? pedido.anexo?.conversaIdDoPedido,
  };
}

function recusa(
  motivo: MotivoRecusaDelegada,
  pedido: PedidoSuperficieDelegada,
  extra: { organization_id?: string } = {},
): ResultadoSuperficieDelegada {
  return { ok: false, motivo, auditoria: auditoria(motivo, pedido, extra) };
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

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim().length > 0 ? valor : null;
}

function objetosStorage(client: ClienteLeitura): unknown {
  if (typeof client.schema === "function") {
    return client.schema("storage").from("objects");
  }
  return client.from("objects");
}

export async function buscarGrantViaClient(q: {
  client: ClienteLeitura;
  userId: string;
  clientId: string;
}): Promise<GrantDelegacaoCorporativa | null | "erro"> {
  const r = await cadeia(q.client.from("delegacao_visibilidade_corporativa"))
    .select("user_id,organization_id,oauth_client_id,efeitos,expires_at,revoked_at")
    .eq("user_id", q.userId)
    .eq("oauth_client_id", q.clientId)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();
  if (r.error) return "erro";
  if (!r.data || typeof r.data !== "object") return null;
  const row = r.data as GrantDelegacaoCorporativa;
  if (!texto(row.user_id) || !texto(row.organization_id) || !texto(row.oauth_client_id)) {
    return null;
  }
  return row;
}

async function sessaoEmpresarial(
  client: ClienteLeitura,
  sessionId: string,
  organizationId: string,
): Promise<boolean | "erro"> {
  const r = await cadeia(client.from("delegacao_sessoes_empresariais"))
    .select("channel_session_id")
    .eq("channel_session_id", sessionId)
    .eq("organization_id", organizationId)
    .is("revoked_at", null)
    .maybeSingle();
  if (r.error) return "erro";
  return Boolean(r.data);
}

async function origemCorporativa(
  client: ClienteLeitura,
  conv: { id: string; organization_id: string; channel_session_id: string },
): Promise<MotivoRecusaDelegada | null | "erro"> {
  const sess = await sessaoEmpresarial(client, conv.channel_session_id, conv.organization_id);
  if (sess === "erro") return "erro";
  if (!sess) return "sessao_nao_empresarial";
  const pessoal = await avaliarContatoPessoalDaConversa(client, conv.organization_id, conv.id);
  if (pessoal.recusar) {
    return pessoal.motivo === "contato_pessoal" ? "contato_pessoal" : "conversa_nao_autorizada";
  }
  return null;
}

export async function executarSuperficieDelegada(
  pedido: PedidoSuperficieDelegada,
  deps: DepsSuperficieDelegada,
): Promise<ResultadoSuperficieDelegada> {
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

  const client = deps.clientDoUsuario(sujeito.sujeito.accessToken);
  let grant: GrantDelegacaoCorporativa | null | "erro";
  try {
    grant = await deps.buscarGrant({
      client,
      userId: sujeito.sujeito.userId,
      clientId: sujeito.sujeito.clientId,
    });
  } catch {
    return recusa("grant_ausente", pedido);
  }
  if (grant === "erro" || !grant) return recusa("grant_ausente", pedido);
  const motivoGrant = grantVivo(grant, sujeito.sujeito, pedido.efeito, deps.agora ?? new Date());
  if (motivoGrant) return recusa(motivoGrant, pedido, { organization_id: grant.organization_id });

  if (pedido.efeito === "buscar") {
    const r = await cadeia(client.from("conversations"))
      .select(COLS_CONVERSA)
      .eq("organization_id", grant.organization_id)
      .limit(100);
    if (r.error) return recusa("conversa_nao_autorizada", pedido, { organization_id: grant.organization_id });
    const linhas = Array.isArray(r.data) ? (r.data as Linha[]) : [];
    return {
      ok: true,
      efeito: "buscar",
      dados: { conversations: linhas },
      auditoria: auditoria("ok", pedido, { organization_id: grant.organization_id }),
    };
  }

  const conversationId = pedido.conversationId as string;
  const convRes = await cadeia(client.from("conversations"))
    .select(COLS_CONVERSA)
    .eq("id", conversationId)
    .eq("organization_id", grant.organization_id)
    .maybeSingle();
  if (convRes.error || !convRes.data || typeof convRes.data !== "object") {
    return recusa("conversa_nao_autorizada", pedido, { organization_id: grant.organization_id });
  }
  const conv = convRes.data as {
    id: string;
    organization_id: string;
    contact_id: string;
    channel_session_id: string;
  };
  const origem = await origemCorporativa(client, conv);
  if (origem === "erro") {
    return recusa("conversa_nao_autorizada", pedido, { organization_id: grant.organization_id });
  }
  if (origem) return recusa(origem, pedido, { organization_id: grant.organization_id });

  if (pedido.efeito === "ler") {
    const msgs = await cadeia(client.from("messages"))
      .select(COLS_MSG)
      .eq("conversation_id", conversationId)
      .eq("organization_id", grant.organization_id)
      .limit(200);
    if (msgs.error) {
      return recusa("conversa_nao_autorizada", pedido, { organization_id: grant.organization_id });
    }
    return {
      ok: true,
      efeito: "ler",
      dados: { conversation: conv, messages: Array.isArray(msgs.data) ? msgs.data : [] },
      auditoria: auditoria("ok", pedido, { organization_id: grant.organization_id }),
    };
  }

  const anexo = pedido.anexo;
  if (!anexo || anexo.conversaIdDoPedido !== conversationId || !texto(anexo.bucket) || !texto(anexo.path)) {
    return recusa("anexo_fora_do_recurso", pedido, { organization_id: grant.organization_id });
  }
  if (anexo.bucket !== "whatsapp-media" && anexo.bucket !== "locacao-processos") {
    return recusa("anexo_fora_do_recurso", pedido, { organization_id: grant.organization_id });
  }

  const obj = await cadeia(objetosStorage(client))
    .select("name,bucket_id")
    .eq("name", anexo.path)
    .eq("bucket_id", anexo.bucket)
    .maybeSingle();
  const visivelNoRest = Boolean(obj.data) && typeof obj.data === "object" && !obj.error;
  const assinado = deps.assinarAposRls
    ? await deps.assinarAposRls({ bucket: anexo.bucket, path: anexo.path })
    : null;
  // PostgREST schema("storage") e Storage API são hops distintos. Bytes
  // passam pela Storage API (RLS no JWT). Sem os dois, anexo fora.
  if (!visivelNoRest && !assinado) {
    return recusa("anexo_fora_do_recurso", pedido, { organization_id: grant.organization_id });
  }

  return {
    ok: true,
    efeito: "baixar",
    dados: {
      bucket: anexo.bucket,
      path: anexo.path,
      visivel: true,
      ...(assinado ?? {}),
    },
    auditoria: auditoria("ok", pedido, { organization_id: grant.organization_id }),
  };
}

/** Recibo opaco para log: não leva body, path completo nem token. */
export function resumoOpacoDelegado(r: ResultadoSuperficieDelegada): Record<string, unknown> {
  const org = r.auditoria.organization_id
    ? createHash("sha256").update(r.auditoria.organization_id).digest("hex").slice(0, 12)
    : null;
  return {
    ok: r.ok,
    motivo: r.ok ? "ok" : r.motivo,
    efeito: r.auditoria.efeito,
    org_hash: org,
  };
}
