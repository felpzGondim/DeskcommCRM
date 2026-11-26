import { afterEach, describe, expect, it } from "vitest";

import { env } from "@/lib/env";

import {
  executarSuperficieDelegada,
  resumoOpacoDelegado,
  type ClienteLeitura,
  type GrantDelegacaoCorporativa,
} from "./delegacao-superficie";
import type { LeitorAuthOAuth } from "./delegacao-oauth-sujeito";

const UID = "aaaaaaaa-0000-4000-8000-000000000001";
const SID = "bbbbbbbb-0000-4000-8000-000000000001";
const CID = "cccccccc-0000-4000-8000-000000000001";
const ORG = "dddddddd-0000-4000-8000-000000000001";
const CONV = "eeeeeeee-0000-4000-8000-000000000001";
const SESS = "ffffffff-0000-4000-8000-000000000001";
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

function leitor(c: Record<string, unknown> = claims()): LeitorAuthOAuth {
  return {
    getUser: async () => ({ data: { user: { id: UID } }, error: null }),
    getClaims: async () => ({ data: { claims: c }, error: null }),
  };
}

type Store = Record<string, { data: unknown; error?: unknown }>;

function client(store: Store, sessoes: unknown[] = []): ClienteLeitura {
  return {
    rpc: async () => ({ data: sessoes, error: null }),
    from(tabela: string) {
      const row = store[tabela] ?? { data: null };
      const self: Record<string, unknown> = {};
      const chain = () => self;
      self.select = chain;
      const filtros: Record<string, string> = {};
      self.eq = (chave: string, valor: string) => {
        filtros[chave] = valor;
        return self;
      };
      const filtrado = () =>
        Array.isArray(row.data)
          ? (row.data as Record<string, unknown>[]).filter((item) =>
              Object.entries(filtros).every(([k, v]) => item[k] === undefined || item[k] === v),
            )
          : row.data;
      self.in = chain;
      self.is = chain;
      self.limit = chain;
      self.maybeSingle = async () => ({
        data: Array.isArray(row.data) ? ((filtrado() as unknown[])[0] ?? null) : row.data,
        error: row.error ?? null,
      });
      self.then = (
        resolve: (v: { data: unknown; error: unknown }) => unknown,
        reject: (e: unknown) => unknown,
      ) => Promise.resolve({ data: filtrado(), error: row.error ?? null }).then(resolve, reject);
      return self;
    },
    schema(nome: string) {
      return {
        from: (tabela: string) => this.from(`${nome}.${tabela}`),
      };
    },
  };
}

const URL_ENV_ANTIGA = env.NEXT_PUBLIC_SUPABASE_URL;

function urlPublicaDoAuthNoTeste(url = "http://127.0.0.1:54321") {
  env.NEXT_PUBLIC_SUPABASE_URL = url;
}

afterEach(() => {
  env.NEXT_PUBLIC_SUPABASE_URL = URL_ENV_ANTIGA;
});

describe("executarSuperficieDelegada", () => {
  it("recusa dsk_ e cookie sem chamar o grant", async () => {
    let grant = 0;
    const r = await executarSuperficieDelegada(
      { authorizationHeader: "Bearer dsk_x", efeito: "buscar" },
      {
        leitorAuth: leitor(),
        agora: AGORA,
        buscarGrants: async () => {
          grant += 1;
          return [GRANT];
        },
        clientDoUsuario: () => client({}),
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("identidade_nao_provada");
    expect(grant).toBe(0);
  });

  it("buscar devolve o que o JWT da pessoa lê (RLS)", async () => {
    urlPublicaDoAuthNoTeste();
    const r = await executarSuperficieDelegada(
      { authorizationHeader: "Bearer token.jwt", efeito: "buscar" },
      {
        leitorAuth: leitor(),
        agora: AGORA,
        buscarGrants: async () => [GRANT],
        clientDoUsuario: () =>
          client({ conversations: { data: [{ id: CONV, organization_id: ORG }] } }),
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.efeito).toBe("buscar");
      expect(r.dados).toEqual({ conversations: [{ id: CONV, organization_id: ORG }] });
    }
  });

  it("busca em dois grants e escolhe o grant da sessão titular pela org da conversa", async () => {
    urlPublicaDoAuthNoTeste();
    const orgTitular = "dddddddd-0000-4000-8000-000000000002";
    const convTitular = "eeeeeeee-0000-4000-8000-000000000002";
    const titular = {
      id: convTitular,
      organization_id: orgTitular,
      contact_id: "ct",
      channel_session_id: SESS,
    };
    const deps = {
      leitorAuth: leitor(),
      agora: AGORA,
      buscarGrants: async () => [GRANT, { ...GRANT, organization_id: orgTitular }],
      clientDoUsuario: () =>
        client(
          {
            conversations: { data: [{ id: CONV, organization_id: ORG }, titular] },
            contacts: { data: { is_personal: false } },
            messages: { data: [{ id: "mensagem" }] },
          },
          [{ channel_session_id: SESS, organization_id: orgTitular, origem: "titular" }],
        ),
    };
    const authorizationHeader = "Bearer token.jwt";
    const busca = await executarSuperficieDelegada({ authorizationHeader, efeito: "buscar" }, deps);
    expect(busca).toMatchObject({
      ok: true,
      dados: { conversations: [{ id: CONV }, { id: convTitular }] },
    });
    const leitura = await executarSuperficieDelegada(
      {
        authorizationHeader,
        efeito: "ler",
        conversationId: convTitular,
      },
      deps,
    );
    expect(leitura).toMatchObject({
      ok: true,
      dados: { conversation: titular, messages: [{ id: "mensagem" }] },
    });
  });

  it("sessão pessoal de outro titular fica invisível ao JWT mesmo com grant de leitura", async () => {
    urlPublicaDoAuthNoTeste();
    const r = await executarSuperficieDelegada(
      { authorizationHeader: "Bearer token.jwt", efeito: "ler", conversationId: CONV },
      {
        leitorAuth: leitor(),
        agora: AGORA,
        buscarGrants: async () => [GRANT],
        clientDoUsuario: () => client({ conversations: { data: null } }),
      },
    );
    expect(r).toMatchObject({ ok: false, motivo: "conversa_nao_autorizada" });
  });

  it("ler recusa sessão sem vínculo mesmo com contato corporativo", async () => {
    urlPublicaDoAuthNoTeste();
    const r = await executarSuperficieDelegada(
      { authorizationHeader: "Bearer token.jwt", efeito: "ler", conversationId: CONV },
      {
        leitorAuth: leitor(),
        agora: AGORA,
        buscarGrants: async () => [GRANT],
        clientDoUsuario: () =>
          client({
            conversations: {
              data: {
                id: CONV,
                organization_id: ORG,
                contact_id: "c1",
                channel_session_id: SESS,
              },
            },
            contacts: { data: { is_personal: false } },
          }),
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("sessao_nao_autorizada");
  });

  it("ler recusa contato pessoal mesmo com vínculo empresarial", async () => {
    urlPublicaDoAuthNoTeste();
    const r = await executarSuperficieDelegada(
      { authorizationHeader: "Bearer token.jwt", efeito: "ler", conversationId: CONV },
      {
        leitorAuth: leitor(),
        agora: AGORA,
        buscarGrants: async () => [GRANT],
        clientDoUsuario: () =>
          client(
            {
              conversations: {
                data: {
                  id: CONV,
                  organization_id: ORG,
                  contact_id: "c1",
                  channel_session_id: SESS,
                },
              },
              contacts: { data: { is_personal: true } },
            },
            [{ channel_session_id: SESS, organization_id: ORG, origem: "empresarial" }],
          ),
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("contato_pessoal");
  });

  it("grant revogado recusa sem expandir efeitos", async () => {
    urlPublicaDoAuthNoTeste();
    const r = await executarSuperficieDelegada(
      { authorizationHeader: "Bearer token.jwt", efeito: "buscar" },
      {
        leitorAuth: leitor(),
        agora: AGORA,
        buscarGrants: async () => [{ ...GRANT, revoked_at: "2026-11-08T00:00:00.000Z" }],
        clientDoUsuario: () => client({}),
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("grant_revogado");
  });

  it("recibo opaco não leva token, body nem path", async () => {
    const r = await executarSuperficieDelegada(
      { authorizationHeader: "Bearer dsk_segredo", efeito: "buscar" },
      {
        leitorAuth: leitor(),
        agora: AGORA,
        buscarGrants: async () => [GRANT],
        clientDoUsuario: () => client({}),
      },
    );
    const opaco = resumoOpacoDelegado(r);
    expect(JSON.stringify(opaco)).not.toMatch(/dsk_|segredo|token\.jwt/i);
  });
});
