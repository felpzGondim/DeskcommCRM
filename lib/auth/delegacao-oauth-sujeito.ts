/**
 * Sujeito OAuth → identidade de usuário do CRM.
 *
 * Contrato documentado (Auth GoTrue OAuth 2.1 Server): o access token É um
 * JWT padrão do Auth (`sub`, `role`, `aud` tipicamente `"authenticated"`,
 * `client_id` presente só em tokens OAuth; sessões cookie têm `client_id`
 * nulo). `getUser(jwt)` valida no Auth (sessão revogada falha mesmo com
 * `exp` futuro). `getClaims(jwt)` lê claims. Não se assina JWT aqui. Não se
 * autoriza por metadado de perfil do Auth. Não se aceita `dsk_`.
 *
 * Audiência RFC 8707 no JWT (`aud` = resource) exige Custom Access Token
 * Hook no Auth — configuração viva, NÃO ligada neste projeto. Este
 * verificador exige `aud` autenticado + `client_id` não vazio. Recurso da
 * superfície é conferido à parte.
 */
import { createUserClientFromAccessToken } from "@/lib/supabase/jwt-usuario";

export const PREFIXO_TOKEN_ORG = "dsk_";

export type MotivoRecusaSujeitoOAuth =
  | "identidade_nao_provada"
  | "token_invalido"
  | "audiencia_invalida"
  | "client_id_ausente";

export type SujeitoOAuth = {
  userId: string;
  clientId: string;
  sessionId: string | null;
  accessToken: string;
  exp: number | null;
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

function audAutenticada(aud: unknown): boolean {
  if (aud === "authenticated") return true;
  return Array.isArray(aud) && aud.includes("authenticated");
}

function textoNaoVazio(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim().length > 0;
}

export function leitorAuthOAuthPadrao(accessToken: string): LeitorAuthOAuth {
  const client = createUserClientFromAccessToken(accessToken);
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

  const leitor = deps.leitor ?? leitorAuthOAuthPadrao(jwt);
  const userRes = await leitor.getUser(jwt);
  if (userRes.error || !userRes.data.user || !textoNaoVazio(userRes.data.user.id)) {
    return { ok: false, motivo: "token_invalido" };
  }
  const userId = userRes.data.user.id.trim();

  const claimsRes = await leitor.getClaims(jwt);
  const claims = claimsRes.data?.claims;
  if (claimsRes.error || !claims || typeof claims !== "object") {
    return { ok: false, motivo: "token_invalido" };
  }

  const sub = claims.sub;
  if (!textoNaoVazio(sub) || sub.trim() !== userId) {
    return { ok: false, motivo: "identidade_nao_provada" };
  }

  const role = claims.role;
  if (role === "service_role" || role === "anon") {
    return { ok: false, motivo: "identidade_nao_provada" };
  }
  if (role !== undefined && role !== "authenticated") {
    return { ok: false, motivo: "identidade_nao_provada" };
  }

  if (!audAutenticada(claims.aud)) {
    return { ok: false, motivo: "audiencia_invalida" };
  }

  const clientId = claims.client_id;
  if (!textoNaoVazio(clientId)) {
    return { ok: false, motivo: "client_id_ausente" };
  }

  const expRaw = claims.exp;
  const exp = typeof expRaw === "number" && Number.isFinite(expRaw) ? expRaw : null;
  const agora = deps.agora ?? new Date();
  if (exp !== null && exp * 1000 <= agora.getTime()) {
    return { ok: false, motivo: "token_invalido" };
  }

  const sessionRaw = claims.session_id;
  const sessionId = textoNaoVazio(sessionRaw) ? sessionRaw.trim() : null;

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
