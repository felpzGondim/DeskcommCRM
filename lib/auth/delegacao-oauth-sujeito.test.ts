import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  PREFIXO_TOKEN_ORG,
  extrairBearer,
  verificarSujeitoOAuth,
  type LeitorAuthOAuth,
} from "./delegacao-oauth-sujeito";

const MARINA = "dddddddd-1111-4111-8111-111111111111";
const FELIPE = "eeeeeeee-2222-4222-8222-222222222222";
const CLIENT = "oauth-client-cursor-test";
const EXP_FUTURO = Math.floor(Date.now() / 1000) + 3600;
const EXP_PASSADO = Math.floor(Date.now() / 1000) - 60;

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
    session_id: "ffffffff-3333-4333-8333-333333333333",
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

  it("getUser falha (sessão revogada / token morto) recusa", async () => {
    const r = await verificarSujeitoOAuth("Bearer jwt-vivo-na-aparencia", {
      leitor: leitor({ userError: "session not found", claims: claimsMarina() }),
    });
    expect(r).toEqual({ ok: false, motivo: "token_invalido" });
  });

  it("exp passado recusa mesmo se getUser devolveu usuário", async () => {
    const r = await verificarSujeitoOAuth("Bearer jwt-expirado", {
      leitor: leitor({ userId: MARINA, claims: claimsMarina({ exp: EXP_PASSADO }) }),
    });
    expect(r).toEqual({ ok: false, motivo: "token_invalido" });
  });

  it("aud que não é authenticated recusa", async () => {
    const r = await verificarSujeitoOAuth("Bearer jwt-aud", {
      leitor: leitor({
        userId: MARINA,
        claims: claimsMarina({ aud: "outro-recurso" }),
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

  it("role service_role recusa", async () => {
    const r = await verificarSujeitoOAuth("Bearer jwt-sr", {
      leitor: leitor({
        userId: MARINA,
        claims: claimsMarina({ role: "service_role" }),
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
        claims: claimsMarina({ sub: FELIPE, client_id: "oauth-client-felipe" }),
      }),
    });
    expect(marina.ok && marina.sujeito.userId).toBe(MARINA);
    expect(felipe.ok && felipe.sujeito.userId).toBe(FELIPE);
    expect(marina.ok && marina.sujeito.clientId).toBe(CLIENT);
  });

  it("não lê user_metadata para autorizar", () => {
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
