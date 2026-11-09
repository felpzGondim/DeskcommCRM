import { afterEach, describe, expect, it } from "vitest";

import {
  extrairBearer,
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

const URL_ANTIGA = process.env.NEXT_PUBLIC_SUPABASE_URL;
afterEach(() => {
  if (URL_ANTIGA === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = URL_ANTIGA;
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
});

describe("verificarSujeitoOAuth", () => {
  it("aceita papel dedicado + client_id + getUser", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
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
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    const r = await verificarSujeitoOAuth("Bearer token.jwt", {
      agora: AGORA,
      leitor: leitor({ userId: UID, claims: claims({ role: "authenticated", client_id: undefined }) }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("papel_nao_dedicado");
  });

  it("recusa client_id ausente mesmo com papel dedicado", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
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
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
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
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    const r = await verificarSujeitoOAuth("Bearer token.jwt", {
      agora: AGORA,
      leitor: leitor({ userId: UID, claims: claims({ exp: AGORA_S - 1 }) }),
    });
    expect(r).toEqual({ ok: false, motivo: "token_invalido" });
  });

  it("não infere nome nem e-mail das claims", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
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
});
