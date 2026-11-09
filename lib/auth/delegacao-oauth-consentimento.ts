/**
 * Consentimento OAuth 2.1 do Auth (tela `/oauth/consent`).
 *
 * GoTrue redireciona o navegador para este caminho com `authorization_id`.
 * A identidade é a sessão normal do CRM (`getUser`). Aprovar/negar vai pelas
 * APIs oficiais `auth.oauth.getAuthorizationDetails` / `approveAuthorization` /
 * `denyAuthorization`. Sem sessão, id inválido ou redirect que não é http(s)
 * → recusa (fail-closed). Não infere e-mail nem nome para log.
 */
import { EFEITOS_DELEGADOS } from "@/lib/auth/delegacao-superficie";

export const CAMINHO_CONSENTIMENTO_OAUTH = "/oauth/consent";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ROTULO_DO_ESCOPO: Record<string, string> = {
  buscar: "Listar conversas da conta empresarial",
  ler: "Ler conversas da conta empresarial",
  baixar: "Baixar anexos da conta empresarial",
};

export type DecisaoConsentimentoOAuth = "aprovar" | "negar";

export type MotivoRecusaConsentimentoOAuth = "sem_login" | "pedido_invalido" | "auth_recusou";

export type ClienteDoConsentimento = {
  id: string;
  name: string;
};

export type DetalhesDoConsentimento = {
  authorizationId: string;
  client: ClienteDoConsentimento;
  escopos: string[];
  usuario: { id: string; email: string };
};

export type OauthConsentimento = {
  getUser: () => Promise<{ id: string } | null>;
  getAuthorizationDetails: (authorizationId: string) => Promise<{
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  }>;
  approveAuthorization: (
    authorizationId: string,
    options?: { skipBrowserRedirect?: boolean },
  ) => Promise<{ data: { redirect_url?: string } | null; error: { message: string } | null }>;
  denyAuthorization: (
    authorizationId: string,
    options?: { skipBrowserRedirect?: boolean },
  ) => Promise<{ data: { redirect_url?: string } | null; error: { message: string } | null }>;
};

export function authorizationIdValido(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return UUID.test(t) ? t.toLowerCase() : null;
}

export function urlDeRedirectDoAuth(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function escoposPedidos(scope: unknown): string[] {
  if (typeof scope !== "string") return [];
  return scope
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function rotuloDoEscopo(escopo: string): string {
  return ROTULO_DO_ESCOPO[escopo] ?? escopo;
}

export function loginComVoltaAoConsentimento(authorizationId: string | null): string {
  const volta = authorizationId
    ? `${CAMINHO_CONSENTIMENTO_OAUTH}?authorization_id=${encodeURIComponent(authorizationId)}`
    : CAMINHO_CONSENTIMENTO_OAUTH;
  return `/login?next=${encodeURIComponent(volta)}`;
}

function textoNaoVazio(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim().length > 0;
}

function detalhesDe(data: Record<string, unknown>): DetalhesDoConsentimento | null {
  const authorizationId = authorizationIdValido(data.authorization_id);
  if (!authorizationId) return null;
  const clientRaw = data.client;
  if (!clientRaw || typeof clientRaw !== "object") return null;
  const client = clientRaw as Record<string, unknown>;
  if (!textoNaoVazio(client.id) || !textoNaoVazio(client.name)) return null;
  const userRaw = data.user;
  if (!userRaw || typeof userRaw !== "object") return null;
  const user = userRaw as Record<string, unknown>;
  if (!textoNaoVazio(user.id) || !textoNaoVazio(user.email)) return null;
  const escopos = escoposPedidos(data.scope);
  if (escopos.length === 0) return null;
  return {
    authorizationId,
    client: { id: client.id.trim(), name: client.name.trim() },
    escopos,
    usuario: { id: user.id.trim(), email: user.email.trim() },
  };
}

export async function carregarDetalhesConsentimento(
  authorizationId: unknown,
  deps: Pick<OauthConsentimento, "getUser" | "getAuthorizationDetails">,
): Promise<
  | { ok: true; detalhes: DetalhesDoConsentimento }
  | { ok: true; redirectUrl: string }
  | { ok: false; motivo: MotivoRecusaConsentimentoOAuth }
> {
  const user = await deps.getUser();
  if (!user) return { ok: false, motivo: "sem_login" };
  const id = authorizationIdValido(authorizationId);
  if (!id) return { ok: false, motivo: "pedido_invalido" };
  const r = await deps.getAuthorizationDetails(id);
  if (r.error || !r.data) return { ok: false, motivo: "auth_recusou" };
  if ("redirect_url" in r.data && !("authorization_id" in r.data)) {
    const url = urlDeRedirectDoAuth(r.data.redirect_url);
    if (!url) return { ok: false, motivo: "auth_recusou" };
    return { ok: true, redirectUrl: url };
  }
  const detalhes = detalhesDe(r.data);
  if (!detalhes) return { ok: false, motivo: "auth_recusou" };
  return { ok: true, detalhes };
}

export async function executarDecisaoConsentimento(
  input: { authorizationId: unknown; decisao: unknown },
  deps: Pick<OauthConsentimento, "getUser" | "approveAuthorization" | "denyAuthorization">,
): Promise<
  | { ok: true; redirectUrl: string; authorizationId: string }
  | { ok: false; motivo: MotivoRecusaConsentimentoOAuth }
> {
  const user = await deps.getUser();
  if (!user) return { ok: false, motivo: "sem_login" };
  const id = authorizationIdValido(input.authorizationId);
  if (!id) return { ok: false, motivo: "pedido_invalido" };
  if (input.decisao !== "aprovar" && input.decisao !== "negar") {
    return { ok: false, motivo: "pedido_invalido" };
  }
  const r =
    input.decisao === "aprovar"
      ? await deps.approveAuthorization(id, { skipBrowserRedirect: true })
      : await deps.denyAuthorization(id, { skipBrowserRedirect: true });
  if (r.error || !r.data) return { ok: false, motivo: "auth_recusou" };
  const url = urlDeRedirectDoAuth(r.data.redirect_url);
  if (!url) return { ok: false, motivo: "auth_recusou" };
  return { ok: true, redirectUrl: url, authorizationId: id };
}

export const ESCOPOS_DELEGADOS_NA_TELA: readonly string[] = EFEITOS_DELEGADOS;
