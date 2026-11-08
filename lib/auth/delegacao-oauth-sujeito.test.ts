import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  PREFIXO_TOKEN_ORG,
  extrairBearer,
  issuerAuthConfigurado,
  issuerAuthDeUrl,
  verificarSujeitoOAuth,
  type LeitorAuthOAuth,
} from "./delegacao-oauth-sujeito";

const MARINA = "dddddddd-1111-4111-8111-111111111111";
const FELIPE = "eeeeeeee-2222-4222-8222-222222222222";
const CLIENT = "oauth-client-cursor-test";
const SESSION = "ffffffff-3333-4333-8333-333333333333";
const EXP_FUTURO = Math.floor(Date.now() / 1000) + 3600;
const EXP_PASSADO = Math.floor(Date.now() / 1000) - 60;
const IAT = Math.floor(Date.now() / 1000) - 30;
const ISS =
  issuerAuthConfigurado() ?? issuerAuthDeUrl("https://test-placeholder.invalid") ?? "";

function leitor(opts: {
  userId?: string | null;
  userError?: string | null;
  claims?: Record<string, unknown> | null;
  claimsError?: string | null;
  onGetUser?: () => void;
  onGetClaims?: () => void;
}): LeitorAuthOAuth {
  return {
    getUser: async () => {
      opts.onGetUser?.();
      if (opts.userError) return { data: { user: null }, error: { message: opts.userError } };
      return {
        data: { user: opts.userId ? { id: opts.userId } : null },
        error: null,
      };
    },
    getClaims: async () => {
      opts.onGetClaims?.();
      if (opts.claimsError) return { data: null, error: { message: opts.claimsError } };
      return {
        data: opts.claims ? { claims: opts.claims } : null,
        error: null,
      };
    },
  };
}

function claimsMarina(parcial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: MARINA,
    role: "authenticated",
    aud: "authenticated",
    client_id: CLIENT,
    session_id: SESSION,
    iss: ISS,
    iat: IAT,
    exp: EXP_FUTURO,
    ...parcial,
  };
}

describe("verificarSujeitoOAuth", () => {
  it("token de organização dsk_ recusa sem chamar Auth", async () => {
    const onGetUser = vi.fn();
    const r = await verificarSujeitoOAuth(`Bearer ${PREFIXO_TOKEN_ORG}abc`, {
      leitor: leitor({ userId: MARINA, claims: claimsMarina(), onGetUser }),
    });
    expect(r).toEqual({ ok: false, motivo: "identidade_nao_provada" });
    expect(onGetUser).not.toHaveBeenCalled();
  });

  it("ausência de Bearer recusa sem Auth", async () => {
    const onGetUser = vi.fn();
    expect(await verificarSujeitoOAuth(null, { leitor: leitor({ onGetUser }) })).toEqual({
      ok: false,
      motivo: "identidade_nao_provada",
    });
    expect(onGetUser).not.toHaveBeenCalled();
  });

  it("getUser com erro recusa — mock não prova revogação no Auth", async () => {
    const onGetClaims = vi.fn();
    const r = await verificarSujeitoOAuth("Bearer jwt-vivo-na-aparencia", {
      leitor: leitor({
        userError: "session not found",
        claims: claimsMarina(),
        onGetClaims,
      }),
    });
    expect(r).toEqual({ ok: false, motivo: "token_invalido" });
    expect(onGetClaims).not.toHaveBeenCalled();
  });

  it("exp ausente recusa mesmo com getUser ok", async () => {
    const { exp: _exp, ...semExp } = claimsMarina();
    void _exp;
    const r = await verificarSujeitoOAuth("Bearer jwt-sem-exp", {
      leitor: leitor({ userId: MARINA, claims: semExp }),
    });
    expect(r).toEqual({ ok: false, motivo: "token_invalido" });
  });

  it("exp não-numérico recusa", async () => {
    const r = await verificarSujeitoOAuth("Bearer jwt-exp-str", {
      leitor: leitor({ userId: MARINA, claims: claimsMarina({ exp: "9999999999" }) }),
    });
    expect(r).toEqual({ ok: false, motivo: "token_invalido" });
  });

  it("exp Infinity recusa", async () => {
    const r = await verificarSujeitoOAuth("Bearer jwt-exp-inf", {
      leitor: leitor({ userId: MARINA, claims: claimsMarina({ exp: Number.POSITIVE_INFINITY }) }),
    });
    expect(r).toEqual({ ok: false, motivo: "token_invalido" });
  });

  it("exp passado recusa mesmo se getUser devolveu usuário", async () => {
    const r = await verificarSujeitoOAuth("Bearer jwt-expirado", {
      leitor: leitor({ userId: MARINA, claims: claimsMarina({ exp: EXP_PASSADO }) }),
    });
    expect(r).toEqual({ ok: false, motivo: "token_invalido" });
  });

  it("role ausente recusa", async () => {
    const { role: _role, ...semRole } = claimsMarina();
    void _role;
    const r = await verificarSujeitoOAuth("Bearer jwt-sem-role", {
      leitor: leitor({ userId: MARINA, claims: semRole }),
    });
    expect(r).toEqual({ ok: false, motivo: "identidade_nao_provada" });
  });

  it("role undefined explícito recusa", async () => {
    const r = await verificarSujeitoOAuth("Bearer jwt-role-undef", {
      leitor: leitor({ userId: MARINA, claims: claimsMarina({ role: undefined }) }),
    });
    expect(r).toEqual({ ok: false, motivo: "identidade_nao_provada" });
  });

  it("role service_role recusa", async () => {
    const r = await verificarSujeitoOAuth("Bearer jwt-sr", {
      leitor: leitor({
        userId: MARINA,
        claims: claimsMarina({ role: "service_role" }),
      }),
    });
    expect(r).toEqual({ ok: false, motivo: "identidade_nao_provada" });
  });

  it("role oauth_delegado recusa — o verificador exige authenticated; o hook oficial também não emite esse claim", async () => {
    const r = await verificarSujeitoOAuth("Bearer jwt-papel-dedicado", {
      leitor: leitor({
        userId: MARINA,
        claims: claimsMarina({ role: "oauth_delegado" }),
      }),
    });
    expect(r).toEqual({ ok: false, motivo: "identidade_nao_provada" });
  });

  it("session_id ausente recusa", async () => {
    const { session_id: _s, ...sem } = claimsMarina();
    void _s;
    const r = await verificarSujeitoOAuth("Bearer jwt-sem-sess", {
      leitor: leitor({ userId: MARINA, claims: sem }),
    });
    expect(r).toEqual({ ok: false, motivo: "token_invalido" });
  });

  it("session_id vazio recusa", async () => {
    const r = await verificarSujeitoOAuth("Bearer jwt-sess-vazia", {
      leitor: leitor({ userId: MARINA, claims: claimsMarina({ session_id: "  " }) }),
    });
    expect(r).toEqual({ ok: false, motivo: "token_invalido" });
  });

  it("session_id malformado recusa", async () => {
    const r = await verificarSujeitoOAuth("Bearer jwt-sess-lixo", {
      leitor: leitor({ userId: MARINA, claims: claimsMarina({ session_id: "nao-e-uuid" }) }),
    });
    expect(r).toEqual({ ok: false, motivo: "token_invalido" });
  });

  it("iss ausente recusa", async () => {
    const { iss: _iss, ...sem } = claimsMarina();
    void _iss;
    const r = await verificarSujeitoOAuth("Bearer jwt-sem-iss", {
      leitor: leitor({ userId: MARINA, claims: sem }),
    });
    expect(r).toEqual({ ok: false, motivo: "token_invalido" });
  });

  it("iss de outro host recusa quando a URL do Auth está configurada", async () => {
    const r = await verificarSujeitoOAuth("Bearer jwt-iss-alheio", {
      leitor: leitor({
        userId: MARINA,
        claims: claimsMarina({ iss: "https://outro.invalid/auth/v1" }),
      }),
    });
    expect(r).toEqual({ ok: false, motivo: "token_invalido" });
  });

  it("iat ausente recusa", async () => {
    const { iat: _iat, ...sem } = claimsMarina();
    void _iat;
    const r = await verificarSujeitoOAuth("Bearer jwt-sem-iat", {
      leitor: leitor({ userId: MARINA, claims: sem }),
    });
    expect(r).toEqual({ ok: false, motivo: "token_invalido" });
  });

  it("aud que não é authenticated recusa (não é URL de recurso)", async () => {
    const r = await verificarSujeitoOAuth("Bearer jwt-aud", {
      leitor: leitor({
        userId: MARINA,
        claims: claimsMarina({ aud: "https://crm.example/api/mcp/delegacao" }),
      }),
    });
    expect(r).toEqual({ ok: false, motivo: "audiencia_invalida" });
  });

  it("client_id ausente (sessão cookie) recusa", async () => {
    const r = await verificarSujeitoOAuth("Bearer jwt-cookie", {
      leitor: leitor({
        userId: MARINA,
        claims: claimsMarina({ client_id: null }),
      }),
    });
    expect(r).toEqual({ ok: false, motivo: "client_id_ausente" });
  });

  it("sub diferente do user.id recusa", async () => {
    const r = await verificarSujeitoOAuth("Bearer jwt-sub", {
      leitor: leitor({
        userId: MARINA,
        claims: claimsMarina({ sub: FELIPE }),
      }),
    });
    expect(r).toEqual({ ok: false, motivo: "identidade_nao_provada" });
  });

  it("user_id divergente do sub recusa", async () => {
    const r = await verificarSujeitoOAuth("Bearer jwt-uid", {
      leitor: leitor({
        userId: MARINA,
        claims: claimsMarina({ user_id: FELIPE }),
      }),
    });
    expect(r).toEqual({ ok: false, motivo: "identidade_nao_provada" });
  });

  it("duas identidades: Marina e Felipe saem com o próprio sub, sem um virar o outro", async () => {
    const marina = await verificarSujeitoOAuth("Bearer jwt-marina", {
      leitor: leitor({ userId: MARINA, claims: claimsMarina() }),
    });
    const felipe = await verificarSujeitoOAuth("Bearer jwt-felipe", {
      leitor: leitor({
        userId: FELIPE,
        claims: claimsMarina({
          sub: FELIPE,
          client_id: "oauth-client-felipe",
          session_id: "aaaaaaaa-4444-4444-8444-444444444444",
        }),
      }),
    });
    expect(marina.ok && marina.sujeito.userId).toBe(MARINA);
    expect(marina.ok && marina.sujeito.sessionId).toBe(SESSION);
    expect(typeof (marina.ok && marina.sujeito.exp)).toBe("number");
    expect(felipe.ok && felipe.sujeito.userId).toBe(FELIPE);
    expect(marina.ok && marina.sujeito.clientId).toBe(CLIENT);
  });

  it("não lê metadado de perfil para autorizar", () => {
    const fonte = fs.readFileSync(path.join(__dirname, "delegacao-oauth-sujeito.ts"), "utf8");
    expect(fonte).not.toMatch(/\buser\.user_metadata\b/);
    expect(fonte).not.toMatch(/\buser\.app_metadata\b/);
    expect(fonte).not.toMatch(/claims\.user_metadata/);
    expect(fonte).not.toMatch(/claims\.app_metadata/);
    expect(fonte).not.toMatch(/from ["']jose["']/);
    expect(fonte).not.toMatch(/createAdminClient/);
    expect(fonte).not.toMatch(/SERVICE_ROLE/);
  });
});

describe("extrairBearer", () => {
  it("só aceita o esquema Bearer", () => {
    expect(extrairBearer("Bearer abc")).toBe("abc");
    expect(extrairBearer("Basic abc")).toBeNull();
    expect(extrairBearer("")).toBeNull();
  });
});
