import { afterEach, describe, expect, it } from "vitest";

import { handleDelegacaoHttp, metadadosRecursoProtegido, wwwAuthenticate } from "./delegacao-http";
import type { ClienteLeitura, GrantDelegacaoCorporativa } from "./delegacao-superficie";
import type { LeitorAuthOAuth } from "./delegacao-oauth-sujeito";

const UID = "aaaaaaaa-0000-4000-8000-000000000001";
const SID = "bbbbbbbb-0000-4000-8000-000000000001";
const CID = "cccccccc-0000-4000-8000-000000000001";
const ORG = "dddddddd-0000-4000-8000-000000000001";
const ISS = "http://127.0.0.1:54321/auth/v1";
const AGORA = new Date("2026-11-08T18:00:00.000Z");
const AGORA_S = AGORA.getTime() / 1000;

const GRANT: GrantDelegacaoCorporativa = {
  user_id: UID,
  organization_id: ORG,
  oauth_client_id: CID,
  efeitos: ["buscar", "ler", "baixar"],
  expires_at: "2026-11-09T18:00:00.000Z",
  revoked_at: null,
};

function leitor(): LeitorAuthOAuth {
  return {
    getUser: async () => ({ data: { user: { id: UID } }, error: null }),
    getClaims: async () => ({
      data: {
        claims: {
          sub: UID,
          role: "oauth_delegado",
          aud: "authenticated",
          iss: ISS,
          client_id: CID,
          session_id: SID,
          exp: AGORA_S + 3600,
          iat: AGORA_S - 10,
        },
      },
      error: null,
    }),
  };
}

function clientVazio(): ClienteLeitura {
  return {
    from() {
      const self: Record<string, unknown> = {};
      const chain = () => self;
      self.select = chain;
      self.eq = chain;
      self.is = chain;
      self.limit = chain;
      self.maybeSingle = async () => ({ data: null, error: null });
      self.then = (resolve: (v: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve);
      return self;
    },
  };
}

const URL_ANTIGA = process.env.NEXT_PUBLIC_SUPABASE_URL;
afterEach(() => {
  if (URL_ANTIGA === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = URL_ANTIGA;
});

function req(method: string, body?: unknown, auth?: string | null): Request {
  const headers: Record<string, string> = { host: "app.test" };
  if (auth !== null) headers.authorization = auth ?? "Bearer token.jwt";
  return new Request("http://app.test/api/mcp/delegacao", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("RFC 9728", () => {
  it("aponta o recurso /api/mcp/delegacao e não /api/mcp", () => {
    const m = metadadosRecursoProtegido("https://app.test");
    expect(m.resource).toBe("https://app.test/api/mcp/delegacao");
    expect(wwwAuthenticate("https://app.test")).toMatch(
      /oauth-protected-resource\/api\/mcp\/delegacao/,
    );
    expect(JSON.stringify(m)).not.toMatch(/\/api\/mcp"/);
  });
});

describe("handleDelegacaoHttp", () => {
  it("GET sem Bearer devolve 401 com WWW-Authenticate", async () => {
    const r = await handleDelegacaoHttp(req("GET", undefined, null), {
      leitorAuth: leitor(),
      agora: AGORA,
      clientDoUsuario: () => clientVazio(),
    });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toMatch(/Bearer/);
  });

  it("POST initialize sem Bearer também 401 (recurso protegido)", async () => {
    const r = await handleDelegacaoHttp(
      req("POST", { jsonrpc: "2.0", id: 1, method: "initialize" }, null),
      { leitorAuth: leitor(), agora: AGORA, clientDoUsuario: () => clientVazio() },
    );
    expect(r.status).toBe(401);
  });

  it("tools/list com JWT dedicado lista buscar/ler/baixar", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    const r = await handleDelegacaoHttp(
      req("POST", { jsonrpc: "2.0", id: 1, method: "tools/list" }),
      { leitorAuth: leitor(), agora: AGORA, clientDoUsuario: () => clientVazio() },
    );
    expect(r.status).toBe(200);
    const j = (await r.json()) as { result: { tools: Array<{ name: string }> } };
    expect(j.result.tools.map((t) => t.name)).toEqual([
      "delegacao_buscar",
      "delegacao_ler",
      "delegacao_baixar",
    ]);
  });

  it("tools/call buscar usa o JWT da pessoa, nunca dsk_/admin", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    let tokenVisto = "";
    const r = await handleDelegacaoHttp(
      req("POST", {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "delegacao_buscar", arguments: {} },
      }),
      {
        leitorAuth: leitor(),
        agora: AGORA,
        clientDoUsuario: (token) => {
          tokenVisto = token;
          return clientVazio();
        },
        buscarGrant: async () => GRANT,
      },
    );
    expect(r.status).toBe(200);
    expect(tokenVisto).toBe("token.jwt");
    expect(tokenVisto).not.toMatch(/^dsk_/);
  });
});
