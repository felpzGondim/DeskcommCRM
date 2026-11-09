import { describe, expect, it } from "vitest";

import {
  CAMINHO_CONSENTIMENTO_OAUTH,
  ESCOPOS_DELEGADOS_NA_TELA,
  authorizationIdValido,
  carregarDetalhesConsentimento,
  executarDecisaoConsentimento,
  loginComVoltaAoConsentimento,
  rotuloDoEscopo,
  urlDeRedirectDoAuth,
  type OauthConsentimento,
} from "./delegacao-oauth-consentimento";

const AUTH_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const CLIENT_ID = "cccccccc-0000-4000-8000-000000000001";
const REDIRECT = "http://127.0.0.1/callback?code=abc&state=s";

function oauth(opts: {
  userId?: string | null;
  details?: Record<string, unknown> | null;
  detailsError?: string | null;
  approveUrl?: string | null;
  approveError?: string | null;
  denyUrl?: string | null;
  denyError?: string | null;
}): OauthConsentimento & { aprovacoes: number; recusas: number; leituras: number } {
  const deps: OauthConsentimento & { aprovacoes: number; recusas: number; leituras: number } = {
    aprovacoes: 0,
    recusas: 0,
    leituras: 0,
    getUser: async () => (opts.userId ? { id: opts.userId } : null),
    getAuthorizationDetails: async () => {
      deps.leituras += 1;
      return {
        data: opts.details ?? null,
        error: opts.detailsError ? { message: opts.detailsError } : null,
      };
    },
    approveAuthorization: async () => {
      deps.aprovacoes += 1;
      return {
        data: opts.approveUrl ? { redirect_url: opts.approveUrl } : null,
        error: opts.approveError ? { message: opts.approveError } : null,
      };
    },
    denyAuthorization: async () => {
      deps.recusas += 1;
      return {
        data: opts.denyUrl ? { redirect_url: opts.denyUrl } : null,
        error: opts.denyError ? { message: opts.denyError } : null,
      };
    },
  };
  return deps;
}

function detalhes(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    authorization_id: AUTH_ID,
    redirect_uri: "http://127.0.0.1/callback",
    client: { id: CLIENT_ID, name: "Bot de leitura", uri: "", logo_uri: "" },
    user: { id: USER_ID, email: "pessoa@example.invalid" },
    scope: "buscar ler baixar",
    ...extra,
  };
}

describe("caminho da tela de consentimento", () => {
  it("é /oauth/consent — o path que o Auth configura", () => {
    expect(CAMINHO_CONSENTIMENTO_OAUTH).toBe("/oauth/consent");
    expect(loginComVoltaAoConsentimento(AUTH_ID)).toBe(
      `/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${AUTH_ID}`)}`,
    );
  });
});

describe("carregarDetalhesConsentimento", () => {
  it("sem login recusa e não fala com o Auth", async () => {
    const deps = oauth({ userId: null, details: detalhes() });
    const r = await carregarDetalhesConsentimento(AUTH_ID, deps);
    expect(r).toEqual({ ok: false, motivo: "sem_login" });
    expect(deps.leituras).toBe(0);
  });

  it("authorization_id inválido recusa e não fala com o Auth", async () => {
    const deps = oauth({ userId: USER_ID, details: detalhes() });
    const r = await carregarDetalhesConsentimento("nao-e-uuid", deps);
    expect(r).toEqual({ ok: false, motivo: "pedido_invalido" });
    expect(deps.leituras).toBe(0);
  });

  it("mostra client, escopos buscar/ler/baixar e o usuário", async () => {
    const deps = oauth({ userId: USER_ID, details: detalhes() });
    const r = await carregarDetalhesConsentimento(AUTH_ID, deps);
    expect(r.ok).toBe(true);
    if (r.ok && "detalhes" in r) {
      expect(r.detalhes.client.name).toBe("Bot de leitura");
      expect(r.detalhes.escopos).toEqual([...ESCOPOS_DELEGADOS_NA_TELA]);
      expect(r.detalhes.usuario.email).toBe("pessoa@example.invalid");
    }
  });
});

describe("executarDecisaoConsentimento", () => {
  it("aprovar devolve o redirect do Auth", async () => {
    const deps = oauth({ userId: USER_ID, approveUrl: REDIRECT });
    const r = await executarDecisaoConsentimento({ authorizationId: AUTH_ID, decisao: "aprovar" }, deps);
    expect(r).toEqual({ ok: true, redirectUrl: REDIRECT, authorizationId: AUTH_ID });
    expect(deps.aprovacoes).toBe(1);
    expect(deps.recusas).toBe(0);
  });

  it("negar devolve o redirect do Auth e não aprova", async () => {
    const deps = oauth({
      userId: USER_ID,
      denyUrl: "http://127.0.0.1/callback?error=access_denied",
    });
    const r = await executarDecisaoConsentimento({ authorizationId: AUTH_ID, decisao: "negar" }, deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.redirectUrl).toContain("error=access_denied");
    expect(deps.aprovacoes).toBe(0);
    expect(deps.recusas).toBe(1);
  });

  it("sem login recusa e não aprova nem nega", async () => {
    const deps = oauth({ userId: null, approveUrl: REDIRECT });
    const r = await executarDecisaoConsentimento({ authorizationId: AUTH_ID, decisao: "aprovar" }, deps);
    expect(r).toEqual({ ok: false, motivo: "sem_login" });
    expect(deps.aprovacoes).toBe(0);
    expect(deps.recusas).toBe(0);
  });

  it("authorization_id inválido recusa e não fala com o Auth", async () => {
    const deps = oauth({ userId: USER_ID, approveUrl: REDIRECT });
    const r = await executarDecisaoConsentimento(
      { authorizationId: "https://evil.example/x", decisao: "aprovar" },
      deps,
    );
    expect(r).toEqual({ ok: false, motivo: "pedido_invalido" });
    expect(deps.aprovacoes).toBe(0);
  });

  it("redirect que não é http(s) é recusado (fail-closed)", async () => {
    const deps = oauth({ userId: USER_ID, approveUrl: "javascript:alert(1)" });
    const r = await executarDecisaoConsentimento({ authorizationId: AUTH_ID, decisao: "aprovar" }, deps);
    expect(r).toEqual({ ok: false, motivo: "auth_recusou" });
  });
});

describe("helpers", () => {
  it("authorization_id só aceita UUID", () => {
    expect(authorizationIdValido(AUTH_ID)).toBe(AUTH_ID);
    expect(authorizationIdValido("")).toBeNull();
    expect(authorizationIdValido("abc")).toBeNull();
  });

  it("rótulos dos três efeitos existem", () => {
    expect(rotuloDoEscopo("buscar")).toMatch(/conversas/);
    expect(rotuloDoEscopo("ler")).toMatch(/conversas/);
    expect(rotuloDoEscopo("baixar")).toMatch(/anexos/);
  });

  it("url de redirect recusa credencial na URL", () => {
    expect(urlDeRedirectDoAuth("http://user:pass@127.0.0.1/x")).toBeNull();
    expect(urlDeRedirectDoAuth(REDIRECT)).toBe(REDIRECT);
  });
});
