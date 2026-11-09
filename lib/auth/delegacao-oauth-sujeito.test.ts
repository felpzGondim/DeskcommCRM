import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { env } from "@/lib/env";

import {
  extrairBearer,
  issuerAuthConfigurado,
  issuerAuthDeUrl,
  verificarSujeitoOAuth,
  type LeitorAuthOAuth,
} from "./delegacao-oauth-sujeito";

const UID = "aaaaaaaa-0000-4000-8000-000000000001";
const SID = "bbbbbbbb-0000-4000-8000-000000000001";
const CID = "cccccccc-0000-4000-8000-000000000001";
const ISS = "http://127.0.0.1:54321/auth/v1";
const AGORA = new Date("2026-11-08T18:00:00.000Z");
const AGORA_S = AGORA.getTime() / 1000;

function claims(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: UID,
    role: "oauth_delegado",
    aud: "authenticated",
    iss: ISS,
    client_id: CID,
    session_id: SID,
    exp: AGORA_S + 3600,
    iat: AGORA_S - 10,
    ...extra,
  };
}

function leitor(opts: {
  userId?: string | null;
  userError?: string | null;
  claims?: Record<string, unknown> | null;
  claimsError?: string | null;
}): LeitorAuthOAuth {
  return {
    getUser: async () => ({
      data: { user: opts.userId ? { id: opts.userId } : null },
      error: opts.userError ? { message: opts.userError } : null,
    }),
    getClaims: async () => ({
      data: opts.claims ? { claims: opts.claims } : null,
      error: opts.claimsError ? { message: opts.claimsError } : null,
    }),
  };
}

const URL_RUNTIME = "http://127.0.0.1:54321";
const URL_ENV_ANTIGA = env.NEXT_PUBLIC_SUPABASE_URL;
const URL_PROCESS_ANTIGA = process.env.NEXT_PUBLIC_SUPABASE_URL;

function urlPublicaDoAuthNoTeste(url: string = URL_RUNTIME) {
  env.NEXT_PUBLIC_SUPABASE_URL = url;
}

afterEach(() => {
  env.NEXT_PUBLIC_SUPABASE_URL = URL_ENV_ANTIGA;
  if (URL_PROCESS_ANTIGA === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = URL_PROCESS_ANTIGA;
});

describe("extrairBearer / issuer", () => {
  it("lê Bearer e recusa vazio", () => {
    expect(extrairBearer("Bearer abc")).toBe("abc");
    expect(extrairBearer("")).toBeNull();
    expect(extrairBearer(null)).toBeNull();
  });

  it("issuer só origem + /auth/v1", () => {
    expect(issuerAuthDeUrl("http://127.0.0.1:54321")).toBe(ISS);
    expect(issuerAuthDeUrl("not a url")).toBeNull();
  });

  it("issuer configurado lê a URL de runtime, não o placeholder assado no build", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://placeholder.supabase.co";
    urlPublicaDoAuthNoTeste("https://o-supabase-do-cliente.supabase.co");
    expect(issuerAuthConfigurado()).toBe("https://o-supabase-do-cliente.supabase.co/auth/v1");
  });

  it("placeholder do Dockerfile não vira issuer (fail-closed)", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://placeholder.supabase.co";
    urlPublicaDoAuthNoTeste("https://placeholder.supabase.co");
    expect(issuerAuthConfigurado()).toBeNull();
  });

  it("nunca lê process.env.NEXT_PUBLIC_* direto (inline de build anunciaria placeholder)", () => {
    const source = readFileSync(join(__dirname, "delegacao-oauth-sujeito.ts"), "utf8");
    expect(source).not.toMatch(/process\.env\.NEXT_PUBLIC_/);
    expect(source).toMatch(/from "@\/lib\/env"/);
  });
});

describe("verificarSujeitoOAuth", () => {
  it("aceita papel dedicado + client_id + getUser", async () => {
    urlPublicaDoAuthNoTeste();
    const r = await verificarSujeitoOAuth("Bearer token.jwt", {
      agora: AGORA,
      leitor: leitor({ userId: UID, claims: claims() }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sujeito.userId).toBe(UID);
      expect(r.sujeito.clientId).toBe(CID);
      expect(r.sujeito.sessionId).toBe(SID);
    }
  });

  it("recusa dsk_ sem chamar o leitor", async () => {
    let chamado = false;
    const r = await verificarSujeitoOAuth("Bearer dsk_secreto", {
      leitor: {
        getUser: async () => {
          chamado = true;
          return { data: { user: null }, error: null };
        },
        getClaims: async () => {
          chamado = true;
          return { data: null, error: null };
        },
      },
    });
    expect(r).toEqual({ ok: false, motivo: "identidade_nao_provada" });
    expect(chamado).toBe(false);
  });

  it("recusa cookie authenticated (papel da sessão)", async () => {
    urlPublicaDoAuthNoTeste();
    const r = await verificarSujeitoOAuth("Bearer token.jwt", {
      agora: AGORA,
      leitor: leitor({ userId: UID, claims: claims({ role: "authenticated", client_id: undefined }) }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("papel_nao_dedicado");
  });

  it("recusa client_id ausente mesmo com papel dedicado", async () => {
    urlPublicaDoAuthNoTeste();
    const r = await verificarSujeitoOAuth("Bearer token.jwt", {
      agora: AGORA,
      leitor: leitor({ userId: UID, claims: claims({ client_id: "" }) }),
    });
    expect(r).toEqual({ ok: false, motivo: "client_id_ausente" });
  });

  it("recusa getUser nulo (sessão Auth)", async () => {
    const r = await verificarSujeitoOAuth("Bearer token.jwt", {
      leitor: leitor({ userId: null, userError: "invalid" }),
    });
    expect(r).toEqual({ ok: false, motivo: "token_invalido" });
  });

  it("recusa sub ≠ user.id", async () => {
    urlPublicaDoAuthNoTeste();
    const r = await verificarSujeitoOAuth("Bearer token.jwt", {
      agora: AGORA,
      leitor: leitor({
        userId: UID,
        claims: claims({ sub: "ffffffff-0000-4000-8000-000000000099" }),
      }),
    });
    expect(r).toEqual({ ok: false, motivo: "identidade_nao_provada" });
  });

  it("recusa exp passado", async () => {
    urlPublicaDoAuthNoTeste();
    const r = await verificarSujeitoOAuth("Bearer token.jwt", {
      agora: AGORA,
      leitor: leitor({ userId: UID, claims: claims({ exp: AGORA_S - 1 }) }),
    });
    expect(r).toEqual({ ok: false, motivo: "token_invalido" });
  });

  it("não infere nome nem e-mail das claims", async () => {
    urlPublicaDoAuthNoTeste();
    const r = await verificarSujeitoOAuth("Bearer token.jwt", {
      agora: AGORA,
      leitor: leitor({
        userId: UID,
        claims: claims({ email: "nao-usar@example.invalid", name: "Nao Inferir" }),
      }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.stringify(r.sujeito)).not.toMatch(/Nao Inferir|nao-usar/i);
    }
  });

  it("recusa JWT cujo iss é o placeholder do build mesmo com URL de runtime", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://placeholder.supabase.co";
    urlPublicaDoAuthNoTeste("https://o-supabase-do-cliente.supabase.co");
    const r = await verificarSujeitoOAuth("Bearer token.jwt", {
      agora: AGORA,
      leitor: leitor({
        userId: UID,
        claims: claims({ iss: "https://placeholder.supabase.co/auth/v1" }),
      }),
    });
    expect(r).toEqual({ ok: false, motivo: "token_invalido" });
  });

  it("fail-closed: placeholder no env não autoriza nenhum iss, nem o próprio placeholder", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://placeholder.supabase.co";
    urlPublicaDoAuthNoTeste("https://placeholder.supabase.co");
    const r = await verificarSujeitoOAuth("Bearer token.jwt", {
      agora: AGORA,
      leitor: leitor({
        userId: UID,
        claims: claims({ iss: "https://placeholder.supabase.co/auth/v1" }),
      }),
    });
    expect(r).toEqual({ ok: false, motivo: "token_invalido" });
  });

  it("fail-closed: sem issuer configurado recusa JWT bem-formado de outro /auth/v1", async () => {
    urlPublicaDoAuthNoTeste("https://placeholder.supabase.co");
    const r = await verificarSujeitoOAuth("Bearer token.jwt", {
      agora: AGORA,
      leitor: leitor({ userId: UID, claims: claims() }),
    });
    expect(r).toEqual({ ok: false, motivo: "token_invalido" });
  });
});
