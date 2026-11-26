/** Superfície OAuth individual. O JWT dedicado é o único sujeito das leituras por RLS. */
import { createHash } from "node:crypto";

import { avaliarContatoPessoalDaConversa } from "./exclusao-contato-pessoal";
import {
  verificarSujeitoOAuth,
  type LeitorAuthOAuth,
  type MotivoRecusaSujeitoOAuth,
  type SujeitoOAuth,
} from "./delegacao-oauth-sujeito";

export const ESCOPOS_OAUTH_DELEGADOS = ["buscar", "ler", "baixar"] as const;
type EfeitoLeitura = (typeof ESCOPOS_OAUTH_DELEGADOS)[number];
export type EfeitoDelegado = EfeitoLeitura | "enviar";
export type OrigemDelegada = "empresarial" | "titular";

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
  | "sessao_nao_autorizada"
  | "anexo_fora_do_recurso";

export type GrantDelegacaoCorporativa = {
  user_id: string;
  organization_id: string;
  oauth_client_id: string;
  efeitos: readonly string[];
  expires_at: string;
  revoked_at: string | null;
};

export type AnexoDaSuperficie = { conversaIdDoPedido: string; bucket: string; path: string };

type RespostaLeitura = { data: unknown; error: unknown };
type Cadeia = {
  select: (cols: string) => Cadeia;
  eq: (coluna: string, valor: string) => Cadeia;
  is: (coluna: string, valor: null) => Cadeia;
  limit: (n: number) => Cadeia;
  maybeSingle: () => PromiseLike<RespostaLeitura>;
  then: PromiseLike<RespostaLeitura>["then"];
};

export type ClienteLeitura = {
  from: (tabela: string) => unknown;
  schema?: (nome: string) => { from: (tabela: string) => unknown };
  // O cliente gerado ainda não contém a RPC desta migration.
  rpc?: unknown;
};

export type DepsSuperficieDelegada = {
  leitorAuth?: LeitorAuthOAuth;
  agora?: Date;
  buscarGrants: typeof buscarGrantsViaClient;
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
  | { ok: true; efeito: EfeitoLeitura; dados: unknown; auditoria: ReciboAuditoriaDelegada }
  | { ok: false; motivo: MotivoRecusaDelegada; auditoria: ReciboAuditoriaDelegada };

type Recusa = { ok: false; motivo: MotivoRecusaDelegada };

type Acesso = {
  client: ClienteLeitura;
  grants: readonly GrantDelegacaoCorporativa[];
  sujeito: SujeitoOAuth;
  agora: Date;
};

type Sessao = {
  channel_session_id: string;
  organization_id: string;
  origem: OrigemDelegada;
  status: string;
};

type Conversa = {
  id: string;
  organization_id: string;
  contact_id: string;
  channel_session_id: string;
};

const COLS_CONVERSA =
  "id,organization_id,contact_id,channel_session_id,status,updated_at,created_at";
const COLS_MSG =
  "id,conversation_id,organization_id,channel_session_id,type,direction,created_at,media_storage_path,body";

function cadeia(origem: unknown): Cadeia {
  return origem as Cadeia;
}

function grantVivo(
  grant: GrantDelegacaoCorporativa,
  sujeito: SujeitoOAuth,
  efeito: EfeitoDelegado,
  agora: Date,
): MotivoRecusaDelegada | null {
  if (grant.user_id !== sujeito.userId) return "identidade_nao_provada";
  if (grant.oauth_client_id !== sujeito.clientId) return "grant_cliente_divergente";
  if (grant.revoked_at) return "grant_revogado";
  const expira = Date.parse(grant.expires_at);
  if (!Number.isFinite(expira) || expira <= agora.getTime()) return "grant_expirado";
  if (!Array.isArray(grant.efeitos) || !grant.efeitos.includes(efeito))
    return "grant_escopo_insuficiente";
  if (!grant.organization_id.trim()) return "org_nao_autorizada";
  return null;
}

export async function buscarGrantsViaClient(q: {
  client: ClienteLeitura;
  userId: string;
  clientId: string;
}): Promise<GrantDelegacaoCorporativa[] | "erro"> {
  const r = await cadeia(q.client.from("delegacao_visibilidade_corporativa"))
    .select("user_id,organization_id,oauth_client_id,efeitos,expires_at,revoked_at")
    .eq("user_id", q.userId)
    .eq("oauth_client_id", q.clientId)
    .is("revoked_at", null);
  return r.error || !Array.isArray(r.data) ? "erro" : (r.data as GrantDelegacaoCorporativa[]);
}

/** A lista é conferida por efeito. A org de um alvo vem da leitura por RLS. */
export async function carregarAcessoDelegado(
  sujeito: SujeitoOAuth,
  deps: Pick<DepsSuperficieDelegada, "agora" | "clientDoUsuario" | "buscarGrants">,
  efeito: EfeitoDelegado,
): Promise<Recusa | { ok: true; acesso: Acesso }> {
  try {
    const client = deps.clientDoUsuario(sujeito.accessToken);
    const grants = await deps.buscarGrants({
      client,
      userId: sujeito.userId,
      clientId: sujeito.clientId,
    });
    if (grants === "erro" || !grants.length) return { ok: false, motivo: "grant_ausente" };
    const agora = deps.agora ?? new Date();
    const vivos = grants.filter((grant) => !grantVivo(grant, sujeito, efeito, agora));
    if (!vivos.length) {
      return {
        ok: false,
        motivo: grantVivo(grants[0]!, sujeito, efeito, agora) ?? "grant_ausente",
      };
    }
    return { ok: true, acesso: { client, grants, sujeito, agora } };
  } catch {
    return { ok: false, motivo: "grant_ausente" };
  }
}

export function grantsComEfeito(
  acesso: Acesso,
  efeito: EfeitoDelegado,
): GrantDelegacaoCorporativa[] {
  return acesso.grants.filter((g) => !grantVivo(g, acesso.sujeito, efeito, acesso.agora));
}

function motivoGrantNaOrg(
  acesso: Acesso,
  efeito: EfeitoDelegado,
  org: string,
): MotivoRecusaDelegada | null {
  const grant = acesso.grants.find((g) => g.organization_id === org && !g.revoked_at);
  return grant ? grantVivo(grant, acesso.sujeito, efeito, acesso.agora) : "org_nao_autorizada";
}

export async function listarSessoesDelegadas(
  client: ClienteLeitura,
  sessionId?: string,
): Promise<Sessao[] | null> {
  if (typeof client.rpc !== "function") return null;
  const r: RespostaLeitura = await client.rpc("fn_delegacao_listar_sessoes", {
    p_session: sessionId ?? null,
  });
  if (r.error || !Array.isArray(r.data)) return null;
  return (r.data as Sessao[]).map(({ channel_session_id, organization_id, origem, status }) => ({
    channel_session_id,
    organization_id,
    origem,
    status,
  }));
}

export async function autorizarSessaoDelegada(
  acesso: Acesso,
  efeito: EfeitoDelegado,
  sessionId: string,
  organizationId?: string,
): Promise<Recusa | { ok: true; sessao: Sessao }> {
  const sessoes = await listarSessoesDelegadas(acesso.client, sessionId);
  const sessao = sessoes?.find(
    (s) =>
      s.channel_session_id === sessionId && (s.origem === "empresarial" || s.origem === "titular"),
  );
  if (!sessao || (organizationId && sessao.organization_id !== organizationId)) {
    return { ok: false, motivo: "sessao_nao_autorizada" };
  }
  const motivo = motivoGrantNaOrg(acesso, efeito, sessao.organization_id);
  return motivo ? { ok: false, motivo } : { ok: true, sessao };
}

export async function autorizarConversaDelegada(
  acesso: Acesso,
  efeito: EfeitoDelegado,
  conversationId: string,
): Promise<Recusa | { ok: true; conversa: Conversa; sessao: Sessao }> {
  const r = await cadeia(acesso.client.from("conversations"))
    .select(COLS_CONVERSA)
    .eq("id", conversationId)
    .maybeSingle();
  if (r.error || !r.data) return { ok: false, motivo: "conversa_nao_autorizada" };
  const conversa = r.data as Conversa;
  const motivo = motivoGrantNaOrg(acesso, efeito, conversa.organization_id);
  if (motivo) return { ok: false, motivo };
  const autorizacao = await autorizarSessaoDelegada(
    acesso,
    efeito,
    conversa.channel_session_id,
    conversa.organization_id,
  );
  if (!autorizacao.ok) return autorizacao;
  const pessoal = await avaliarContatoPessoalDaConversa(
    acesso.client,
    conversa.organization_id,
    conversa.id,
  );
  if (pessoal.recusar) {
    return {
      ok: false,
      motivo: pessoal.motivo === "contato_pessoal" ? "contato_pessoal" : "conversa_nao_autorizada",
    };
  }
  return { ok: true, conversa, sessao: autorizacao.sessao };
}

export const BUCKETS_ANEXO_DELEGADO = ["whatsapp-media", "locacao-processos"] as const;

export async function anexoVisivelViaRest(
  client: ClienteLeitura,
  anexo: { bucket: string; path: string },
): Promise<boolean> {
  if (!BUCKETS_ANEXO_DELEGADO.some((b) => b === anexo.bucket) || !anexo.path.trim()) return false;
  const objetos = client.schema ? client.schema("storage").from("objects") : client.from("objects");
  const obj = await cadeia(objetos)
    .select("name,bucket_id")
    .eq("name", anexo.path)
    .eq("bucket_id", anexo.bucket)
    .maybeSingle();
  return Boolean(obj.data) && !obj.error;
}

export async function executarSuperficieDelegada(
  pedido: PedidoSuperficieDelegada,
  deps: DepsSuperficieDelegada,
  sujeitoVerificado?: SujeitoOAuth,
): Promise<ResultadoSuperficieDelegada> {
  const efeito = pedido.efeito;
  const auditoria: ReciboAuditoriaDelegada = {
    motivo: "ok",
    efeito,
    conversation_id: pedido.conversationId ?? pedido.anexo?.conversaIdDoPedido,
  };
  const recusa = (motivo: MotivoRecusaDelegada): ResultadoSuperficieDelegada => ({
    ok: false,
    motivo,
    auditoria: { ...auditoria, motivo },
  });

  if (efeito !== "buscar" && efeito !== "ler" && efeito !== "baixar")
    return recusa("efeito_nao_permitido");
  if (efeito !== "buscar" && !pedido.conversationId) return recusa("conversa_nao_autorizada");

  const sujeito = sujeitoVerificado
    ? { ok: true as const, sujeito: sujeitoVerificado }
    : await verificarSujeitoOAuth(pedido.authorizationHeader, {
        leitor: deps.leitorAuth,
        agora: deps.agora,
      });
  if (!sujeito.ok) return recusa(sujeito.motivo);
  const auth = await carregarAcessoDelegado(sujeito.sujeito, deps, efeito);
  if (!auth.ok) return recusa(auth.motivo);
  const { acesso } = auth;
  const { client } = acesso;

  if (efeito === "buscar") {
    const grants = grantsComEfeito(acesso, efeito);
    const consultas = await Promise.all(
      grants.map((g) =>
        cadeia(client.from("conversations"))
          .select(COLS_CONVERSA)
          .eq("organization_id", g.organization_id)
          .limit(100),
      ),
    );
    if (consultas.some((r) => r.error)) return recusa("conversa_nao_autorizada");
    if (grants.length === 1) auditoria.organization_id = grants[0]?.organization_id;
    return {
      ok: true,
      efeito,
      auditoria,
      dados: { conversations: consultas.flatMap((r) => (Array.isArray(r.data) ? r.data : [])) },
    };
  }

  const alvo = await autorizarConversaDelegada(acesso, efeito, pedido.conversationId!);
  if (!alvo.ok) return recusa(alvo.motivo);
  const { conversa } = alvo;
  auditoria.organization_id = conversa.organization_id;

  if (efeito === "ler") {
    const msgs = await cadeia(client.from("messages"))
      .select(COLS_MSG)
      .eq("conversation_id", conversa.id)
      .eq("organization_id", conversa.organization_id)
      .limit(200);
    if (msgs.error) return recusa("conversa_nao_autorizada");
    return {
      ok: true,
      efeito,
      auditoria,
      dados: { conversation: conversa, messages: Array.isArray(msgs.data) ? msgs.data : [] },
    };
  }

  const anexo = pedido.anexo;
  if (
    !anexo ||
    anexo.conversaIdDoPedido !== conversa.id ||
    !anexo.path.trim() ||
    !BUCKETS_ANEXO_DELEGADO.some((b) => b === anexo.bucket)
  ) {
    return recusa("anexo_fora_do_recurso");
  }
  const visivelNoRest = await anexoVisivelViaRest(client, anexo);
  const assinado = await deps.assinarAposRls?.({ bucket: anexo.bucket, path: anexo.path });
  // A Storage API também avalia RLS com o JWT. Pode estar acessível mesmo
  // quando o PostgREST da instalação não publica o schema storage.
  if (!visivelNoRest && !assinado) return recusa("anexo_fora_do_recurso");
  return {
    ok: true,
    efeito,
    auditoria,
    dados: { bucket: anexo.bucket, path: anexo.path, visivel: true, ...assinado },
  };
}

/** Recibo opaco para log: não leva corpo, path nem token. */
export function resumoOpacoDelegado(r: ResultadoSuperficieDelegada): Record<string, unknown> {
  const org = r.auditoria.organization_id;
  return {
    ok: r.ok,
    motivo: r.auditoria.motivo,
    efeito: r.auditoria.efeito,
    org_hash: org ? createHash("sha256").update(org).digest("hex").slice(0, 12) : null,
  };
}
