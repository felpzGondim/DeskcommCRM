/**
 * Sujeito OAuth com papel dedicado `oauth_delegado`.
 *
 * O access token É um JWT de usuário emitido pelo Auth. Este verificador
 * NÃO assina, NÃO lê metadado de perfil, NÃO aceita `dsk_`, NÃO aceita
 * cookie (`client_id` vazio) e NÃO aceita `role=authenticated` — a cookie
 * continua no caminho de sessão. Recusa `role` diferente de `oauth_delegado`.
 */
import { env } from "@/lib/env";
import { createAnonAuthLeitor } from "@/lib/supabase/jwt-usuario";

export const PREFIXO_TOKEN_ORG = "dsk_";

const UUID_CLAIM =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SKEW_IAT_FUTURO_S = 60;

export type MotivoRecusaSujeitoOAuth =
  | "identidade_nao_provada"
  | "token_invalido"
  | "audiencia_invalida"
  | "client_id_ausente"
  | "papel_nao_dedicado";

export type SujeitoOAuth = {
  userId: string;
  clientId: string;
  sessionId: string;
  accessToken: string;
  exp: number;
};

export type ResultadoSujeitoOAuth =
  | { ok: true; sujeito: SujeitoOAuth }
  | { ok: false; motivo: MotivoRecusaSujeitoOAuth };

export type LeitorAuthOAuth = {
  getUser: (
    jwt: string,
  ) => Promise<{
    data: { user: { id: string } | null };
    error: { message: string } | null;
  }>;
  getClaims: (
    jwt: string,
  ) => Promise<{
    data: { claims: Record<string, unknown> } | null;
    error: { message: string } | null;
  }>;
};

export function extrairBearer(authorizationHeader: string | null | undefined): string | null {
  if (!authorizationHeader) return null;
  const m = /^Bearer\s+(\S+)/i.exec(authorizationHeader.trim());
  const token = m?.[1]?.trim() ?? "";
  return token.length > 0 ? token : null;
}

export function issuerAuthDeUrl(supabaseUrl: string): string | null {
  try {
    const u = new URL(supabaseUrl.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.host || u.username || u.password) return null;
    return `${u.protocol}//${u.host}/auth/v1`;
  } catch {
    return null;
  }
}

/**
 * ARG default do Dockerfile da imagem genérica. O Next INLINA acesso
 * literal `process.env` + `NEXT_PUBLIC_*` no build; se o well-known lesse
 * isso, o Bot receberia `https://placeholder.supabase.co/auth/v1` mesmo com
 * a URL real no `.env` de runtime.
 */
function urlDoSupabaseEPlaceholderDeBuild(url: string): boolean {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    if (host === "placeholder.supabase.co") return true;
    if (host.includes("placeholder") && host.endsWith(".invalid")) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Issuer GoTrue anunciado (RFC 9728) e conferido no JWT: origem pública + `/auth/v1`.
 *
 * Lê `env.NEXT_PUBLIC_SUPABASE_URL` (parse do objeto `process.env` em runtime),
 * o mesmo caminho que `lib/supabase/server.ts` e `jwt-usuario.ts` já usam.
 * Nunca acesso literal `process.env` + `NEXT_PUBLIC_SUPABASE_URL` — o
 * compilador do Next substitui esse acesso no build, e a imagem genérica
 * assa `https://placeholder.supabase.co`.
 *
 * Vazio, inválido ou placeholder de build → `null` (fail-closed). Não cai para
 * `SUPABASE_SERVER_URL`: essa é a origem interna (Kong) do transporte; o `iss`
 * do JWT e `authorization_servers` são o que o cliente alcança.
 */
export function issuerAuthConfigurado(): string | null {
  const raw = env.NEXT_PUBLIC_SUPABASE_URL;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  if (urlDoSupabaseEPlaceholderDeBuild(raw)) return null;
  return issuerAuthDeUrl(raw);
}

function audAutenticada(aud: unknown): boolean {
  if (aud === "authenticated") return true;
  return Array.isArray(aud) && aud.length === 1 && aud[0] === "authenticated";
}

function textoNaoVazio(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim().length > 0;
}

function uuidClaim(valor: unknown): string | null {
  if (!textoNaoVazio(valor)) return null;
  const t = valor.trim();
  return UUID_CLAIM.test(t) ? t.toLowerCase() : null;
}

function numeroUnixFinito(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

function issAceito(iss: unknown, esperado: string | null): boolean {
  if (!textoNaoVazio(iss)) return false;
  const normalizado = issuerAuthDeUrl(iss);
  if (!normalizado) return false;
  try {
    const u = new URL(iss.trim());
    const path = u.pathname.replace(/\/+$/, "");
    if (path !== "/auth/v1") return false;
    if (u.search || u.hash) return false;
  } catch {
    return false;
  }
  if (!esperado) return false;
  return normalizado === esperado;
}

export function leitorAuthOAuthPadrao(): LeitorAuthOAuth {
  const client = createAnonAuthLeitor();
  return {
    getUser: (jwt) => client.auth.getUser(jwt),
    getClaims: async (jwt) => {
      const r = await client.auth.getClaims(jwt);
      const claims =
        r.data && typeof r.data === "object" && "claims" in r.data
          ? (r.data.claims as Record<string, unknown>)
          : null;
      return {
        data: claims ? { claims } : null,
        error: r.error ? { message: r.error.message } : null,
      };
    },
  };
}

/**
 * Prova o usuário do CRM a partir do Bearer. Recusas não chamam o leitor
 * quando o prefixo já é token de organização (`dsk_`).
 *
 * `getUser` é pedido de rede ao Auth (sessão encerrada). Teste com leitor
 * injetado NÃO prova o Auth — prova só o fail-closed desta função.
 */
export async function verificarSujeitoOAuth(
  authorizationHeader: string | null | undefined,
  deps: { leitor?: LeitorAuthOAuth; agora?: Date } = {},
): Promise<ResultadoSujeitoOAuth> {
  const jwt = extrairBearer(authorizationHeader);
  if (!jwt) return { ok: false, motivo: "identidade_nao_provada" };
  if (jwt.startsWith(PREFIXO_TOKEN_ORG)) {
    return { ok: false, motivo: "identidade_nao_provada" };
  }

  const leitor = deps.leitor ?? leitorAuthOAuthPadrao();
  const userRes = await leitor.getUser(jwt);
  if (userRes.error || !userRes.data.user || !textoNaoVazio(userRes.data.user.id)) {
    return { ok: false, motivo: "token_invalido" };
  }
  const userId = uuidClaim(userRes.data.user.id);
  if (!userId) return { ok: false, motivo: "identidade_nao_provada" };

  const claimsRes = await leitor.getClaims(jwt);
  const claims = claimsRes.data?.claims;
  if (claimsRes.error || !claims || typeof claims !== "object") {
    return { ok: false, motivo: "token_invalido" };
  }

  const sub = uuidClaim(claims.sub);
  if (!sub || sub !== userId) {
    return { ok: false, motivo: "identidade_nao_provada" };
  }

  if ("user_id" in claims) {
    const userIdClaim = uuidClaim(claims.user_id);
    if (!userIdClaim || userIdClaim !== sub) {
      return { ok: false, motivo: "identidade_nao_provada" };
    }
  }

  if (claims.role !== "oauth_delegado") {
    return { ok: false, motivo: "papel_nao_dedicado" };
  }

  if (!audAutenticada(claims.aud)) {
    return { ok: false, motivo: "audiencia_invalida" };
  }

  if (!issAceito(claims.iss, issuerAuthConfigurado())) {
    return { ok: false, motivo: "token_invalido" };
  }

  const clientId = claims.client_id;
  if (!textoNaoVazio(clientId)) {
    return { ok: false, motivo: "client_id_ausente" };
  }

  const sessionId = uuidClaim(claims.session_id);
  if (!sessionId) {
    return { ok: false, motivo: "token_invalido" };
  }

  const agora = deps.agora ?? new Date();
  const agoraS = agora.getTime() / 1000;
  const exp = numeroUnixFinito(claims.exp);
  if (exp === null || exp <= agoraS) {
    return { ok: false, motivo: "token_invalido" };
  }

  const iat = numeroUnixFinito(claims.iat);
  if (iat === null || iat > agoraS + SKEW_IAT_FUTURO_S || iat >= exp) {
    return { ok: false, motivo: "token_invalido" };
  }

  const nbf = claims.nbf;
  if (nbf !== undefined) {
    const nbfN = numeroUnixFinito(nbf);
    if (nbfN === null || nbfN > agoraS) {
      return { ok: false, motivo: "token_invalido" };
    }
  }

  return {
    ok: true,
    sujeito: {
      userId,
      clientId: clientId.trim(),
      sessionId,
      accessToken: jwt,
      exp,
    },
  };
}
