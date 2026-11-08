import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { ATIVACAO_DELEGADA_PADRAO } from "./delegacao-empresarial";
import {
  executarSuperficieDelegada,
  interpretarClassificacaoEmpresarial,
  type DepsSuperficieDelegada,
  type GrantDelegacaoCorporativa,
} from "./delegacao-superficie";
import { issuerAuthConfigurado, issuerAuthDeUrl, type LeitorAuthOAuth } from "./delegacao-oauth-sujeito";

const MARINA = "dddddddd-1111-4111-8111-111111111111";
const FELIPE = "eeeeeeee-2222-4222-8222-222222222222";
const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "22222222-2222-4222-8222-222222222222";
const CONV = "aaaaaaaa-1111-4111-8111-111111111111";
const CLIENT = "oauth-client-cursor-test";
const SESSION = "ffffffff-3333-4333-8333-333333333333";
const EXP_FUTURO = Math.floor(Date.now() / 1000) + 3600;
const IAT = Math.floor(Date.now() / 1000) - 30;
const ISS =
  issuerAuthConfigurado() ?? issuerAuthDeUrl("https://test-placeholder.invalid") ?? "";

function leitorDe(userId: string, parcial: Record<string, unknown> = {}): LeitorAuthOAuth {
  const claims = {
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
    client_id: CLIENT,
    session_id: SESSION,
    iss: ISS,
    iat: IAT,
    exp: EXP_FUTURO,
    ...parcial,
  };
  return {
    getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    getClaims: async () => ({ data: { claims }, error: null }),
  };
}

function grantMarina(parcial: Partial<GrantDelegacaoCorporativa> = {}): GrantDelegacaoCorporativa {
  return {
    user_id: MARINA,
    organization_id: ORG,
    oauth_client_id: CLIENT,
    efeitos: ["buscar", "ler", "baixar"],
    expires_at: new Date(Date.now() + 86400_000).toISOString(),
    revoked_at: null,
    ...parcial,
  };
}

function deps(parcial: Partial<DepsSuperficieDelegada> = {}): DepsSuperficieDelegada {
  return {
    leitorAuth: leitorDe(MARINA),
    buscarGrant: async () => grantMarina(),
    lerClassificacaoDaConversa: async () => "corporativa",
    clientDoUsuario: () => ({ from: () => ({}) }),
    avaliarContato: async () => ({ recusar: false }),
    ...parcial,
  };
}

const ativada = { ativa: true, contratoAprovado: true } as const;

describe("executarSuperficieDelegada — default deny", () => {
  it("ativação padrão não busca, não lê, não assina, não chama Auth", async () => {
    const buscar = vi.fn(async () => [{ id: CONV }]);
    const baixarAssinar = vi.fn(async () => ({ url: "https://storage.example/x" }));
    const getUser = vi.fn();
    const r = await executarSuperficieDelegada(
      {
        authorizationHeader: "Bearer jwt-marina",
        efeito: "buscar",
      },
      deps({
        leitorAuth: {
          getUser: async () => {
            getUser();
            return { data: { user: { id: MARINA } }, error: null };
          },
          getClaims: async () => ({ data: { claims: {} }, error: null }),
        },
        buscar,
        baixarAssinar,
      }),
    );
    expect(ATIVACAO_DELEGADA_PADRAO).toEqual({ ativa: false, contratoAprovado: false });
    expect(r).toMatchObject({ ok: false, motivo: "integracao_nao_ativada" });
    expect(buscar).not.toHaveBeenCalled();
    expect(baixarAssinar).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe("executarSuperficieDelegada — duas identidades e recusas", () => {
  it("Marina com grant vivo busca; Felipe com o mesmo header de Marina não herda o grant", async () => {
    const buscar = vi.fn(async () => [{ id: CONV }]);
    const marina = await executarSuperficieDelegada(
      { ativacao: ativada, authorizationHeader: "Bearer jwt-marina", efeito: "buscar" },
      deps({ buscar }),
    );
    expect(marina.ok).toBe(true);
    if (marina.ok) expect(marina.efeito).toBe("buscar");
    expect(buscar).toHaveBeenCalledOnce();

    const buscarFelipe = vi.fn(async () => [{ id: CONV }]);
    const felipe = await executarSuperficieDelegada(
      { ativacao: ativada, authorizationHeader: "Bearer jwt-felipe", efeito: "buscar" },
      deps({
        leitorAuth: leitorDe(FELIPE, { sub: FELIPE }),
        buscarGrant: async ({ userId }) => (userId === MARINA ? grantMarina() : null),
        buscar: buscarFelipe,
      }),
    );
    expect(felipe).toMatchObject({ ok: false, motivo: "grant_ausente" });
    expect(buscarFelipe).not.toHaveBeenCalled();
  });

  it("grant revogado recusa sem assinar", async () => {
    const baixarAssinar = vi.fn(async () => ({ url: "https://storage.example/x" }));
    const r = await executarSuperficieDelegada(
      {
        ativacao: ativada,
        authorizationHeader: "Bearer jwt-marina",
        efeito: "baixar",
        conversationId: CONV,
        anexo: { conversaIdDoPedido: CONV, conversaIdDoAnexo: CONV },
      },
      deps({
        buscarGrant: async () => grantMarina({ revoked_at: new Date().toISOString() }),
        baixarAssinar,
      }),
    );
    expect(r).toMatchObject({ ok: false, motivo: "grant_revogado" });
    expect(baixarAssinar).not.toHaveBeenCalled();
  });

  it("grant expirado recusa sem assinar", async () => {
    const baixarAssinar = vi.fn(async () => ({ url: "https://storage.example/x" }));
    const r = await executarSuperficieDelegada(
      {
        ativacao: ativada,
        authorizationHeader: "Bearer jwt-marina",
        efeito: "baixar",
        conversationId: CONV,
        anexo: { conversaIdDoPedido: CONV, conversaIdDoAnexo: CONV },
      },
      deps({
        buscarGrant: async () =>
          grantMarina({ expires_at: new Date(Date.now() - 1000).toISOString() }),
        baixarAssinar,
      }),
    );
    expect(r).toMatchObject({ ok: false, motivo: "grant_expirado" });
    expect(baixarAssinar).not.toHaveBeenCalled();
  });

  it("escopo sem baixar recusa download", async () => {
    const baixarAssinar = vi.fn(async () => ({ url: "https://storage.example/x" }));
    const r = await executarSuperficieDelegada(
      {
        ativacao: ativada,
        authorizationHeader: "Bearer jwt-marina",
        efeito: "baixar",
        conversationId: CONV,
        anexo: { conversaIdDoPedido: CONV, conversaIdDoAnexo: CONV },
      },
      deps({
        buscarGrant: async () => grantMarina({ efeitos: ["buscar", "ler"] }),
        baixarAssinar,
      }),
    );
    expect(r).toMatchObject({ ok: false, motivo: "grant_escopo_insuficiente" });
    expect(baixarAssinar).not.toHaveBeenCalled();
  });

  it("client_id do token diferente do grant recusa", async () => {
    const buscar = vi.fn(async () => []);
    const r = await executarSuperficieDelegada(
      { ativacao: ativada, authorizationHeader: "Bearer jwt-marina", efeito: "buscar" },
      deps({
        buscarGrant: async () => grantMarina({ oauth_client_id: "outro-client" }),
        buscar,
      }),
    );
    expect(r).toMatchObject({ ok: false, motivo: "grant_cliente_divergente" });
    expect(buscar).not.toHaveBeenCalled();
  });

  it("token de Felipe não usa grant de Marina mesmo se o lookup devolver a linha dela", async () => {
    const buscar = vi.fn(async () => []);
    const r = await executarSuperficieDelegada(
      { ativacao: ativada, authorizationHeader: "Bearer jwt-felipe", efeito: "buscar" },
      deps({
        leitorAuth: leitorDe(FELIPE, { sub: FELIPE }),
        buscarGrant: async () => grantMarina(),
        buscar,
      }),
    );
    expect(r).toMatchObject({ ok: false, motivo: "identidade_nao_provada" });
    expect(buscar).not.toHaveBeenCalled();
  });

  it("classificação desconhecida recusa leitura sem assinar", async () => {
    const ler = vi.fn(async () => ({ body: "segredo" }));
    const baixarAssinar = vi.fn(async () => ({ url: "https://storage.example/x" }));
    const r = await executarSuperficieDelegada(
      {
        ativacao: ativada,
        authorizationHeader: "Bearer jwt-marina",
        efeito: "ler",
        conversationId: CONV,
      },
      deps({
        lerClassificacaoDaConversa: async () => "nao_classificada",
        ler,
        baixarAssinar,
      }),
    );
    expect(r).toMatchObject({ ok: false, motivo: "sessao_nao_classificada" });
    expect(ler).not.toHaveBeenCalled();
    expect(baixarAssinar).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toMatch(/segredo|storage\.example/i);
  });

  it("sessão pessoal recusa", async () => {
    const ler = vi.fn(async () => ({ body: "pessoal" }));
    const r = await executarSuperficieDelegada(
      {
        ativacao: ativada,
        authorizationHeader: "Bearer jwt-marina",
        efeito: "ler",
        conversationId: CONV,
      },
      deps({
        lerClassificacaoDaConversa: async () => "pessoal",
        ler,
      }),
    );
    expect(r).toMatchObject({ ok: false, motivo: "sessao_pessoal" });
    expect(ler).not.toHaveBeenCalled();
  });

  it("contato pessoal recusa sem assinar", async () => {
    const baixarAssinar = vi.fn(async () => ({ url: "https://storage.example/x" }));
    const r = await executarSuperficieDelegada(
      {
        ativacao: ativada,
        authorizationHeader: "Bearer jwt-marina",
        efeito: "baixar",
        conversationId: CONV,
        anexo: { conversaIdDoPedido: CONV, conversaIdDoAnexo: CONV },
      },
      deps({
        avaliarContato: async () => ({ recusar: true, motivo: "contato_pessoal" }),
        baixarAssinar,
      }),
    );
    expect(r).toMatchObject({ ok: false, motivo: "contato_pessoal" });
    expect(baixarAssinar).not.toHaveBeenCalled();
  });

  it("lookup de grant que lança recusa sem buscar nem assinar", async () => {
    const buscar = vi.fn(async () => []);
    const baixarAssinar = vi.fn(async () => ({ url: "https://storage.example/x" }));
    const r = await executarSuperficieDelegada(
      { ativacao: ativada, authorizationHeader: "Bearer jwt-marina", efeito: "buscar" },
      deps({
        buscarGrant: async () => {
          throw new Error("db down");
        },
        buscar,
        baixarAssinar,
      }),
    );
    expect(r).toMatchObject({ ok: false, motivo: "grant_ausente" });
    expect(buscar).not.toHaveBeenCalled();
    expect(baixarAssinar).not.toHaveBeenCalled();
  });

  it("exp ausente no token recusa sem lookup de grant", async () => {
    const buscarGrant = vi.fn(async () => grantMarina());
    const buscar = vi.fn(async () => []);
    const r = await executarSuperficieDelegada(
      { ativacao: ativada, authorizationHeader: "Bearer jwt-sem-exp", efeito: "buscar" },
      deps({
        leitorAuth: leitorDe(MARINA, { exp: undefined }),
        buscarGrant,
        buscar,
      }),
    );
    expect(r).toMatchObject({ ok: false, motivo: "token_invalido" });
    expect(buscarGrant).not.toHaveBeenCalled();
    expect(buscar).not.toHaveBeenCalled();
  });

  it("dsk_ recusa identidade sem lookup de grant", async () => {
    const buscarGrant = vi.fn(async () => grantMarina());
    const buscar = vi.fn(async () => []);
    const r = await executarSuperficieDelegada(
      { ativacao: ativada, authorizationHeader: "Bearer dsk_org", efeito: "buscar" },
      deps({ buscarGrant, buscar }),
    );
    expect(r).toMatchObject({ ok: false, motivo: "identidade_nao_provada" });
    expect(buscarGrant).not.toHaveBeenCalled();
    expect(buscar).not.toHaveBeenCalled();
  });

  it("aud errada recusa sem grant", async () => {
    const buscarGrant = vi.fn(async () => grantMarina());
    const r = await executarSuperficieDelegada(
      { ativacao: ativada, authorizationHeader: "Bearer jwt-aud", efeito: "buscar" },
      deps({
        leitorAuth: leitorDe(MARINA, { aud: "nao-authenticated" }),
        buscarGrant,
      }),
    );
    expect(r).toMatchObject({ ok: false, motivo: "audiencia_invalida" });
    expect(buscarGrant).not.toHaveBeenCalled();
  });

  it("grant de outra org não é usado: org sai da linha do grant, não do body", async () => {
    const buscar = vi.fn(async () => []);
    const r = await executarSuperficieDelegada(
      { ativacao: ativada, authorizationHeader: "Bearer jwt-marina", efeito: "buscar" },
      deps({
        buscarGrant: async () => grantMarina({ organization_id: OUTRA_ORG }),
        buscar,
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.auditoria.organization_id).toBe(OUTRA_ORG);
    expect(buscar).toHaveBeenCalledOnce();
  });
});

describe("interpretarClassificacaoEmpresarial", () => {
  it("só corporativa literal passa; null e lixo são desconhecidos", () => {
    expect(interpretarClassificacaoEmpresarial("corporativa")).toBe("corporativa");
    expect(interpretarClassificacaoEmpresarial("pessoal")).toBe("pessoal");
    expect(interpretarClassificacaoEmpresarial(null)).toBe("nao_classificada");
    expect(interpretarClassificacaoEmpresarial("CORPORATIVA")).toBe("nao_classificada");
    expect(interpretarClassificacaoEmpresarial(true)).toBe("nao_classificada");
  });
});

describe("contrato da superfície", () => {
  it("não importa admin, não assina JWT, não usa user_metadata", () => {
    const fonte = fs.readFileSync(path.join(__dirname, "delegacao-superficie.ts"), "utf8");
    expect(fonte).not.toMatch(/createAdminClient/);
    expect(fonte).not.toMatch(/SERVICE_ROLE/);
    expect(fonte).not.toMatch(/user_metadata/);
    expect(fonte).not.toMatch(/from ["']jose["']/);
    expect(fonte).not.toMatch(/chatPrivadoDoBot/);
    expect(fonte).not.toMatch(/conversaAutorizadaParaOUsuario/);
  });
});
