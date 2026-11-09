import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/i18n/idiomaAnonimo", () => ({ idiomaDoVisitante: vi.fn(async () => "pt-BR") }));
vi.mock("@/lib/i18n/dicionario", () => ({ traduzir: (texto: string) => texto }));
vi.mock("@/lib/i18n/titulo-da-tela-publica", () => ({
  tituloDaTelaPublica: vi.fn(async () => ({ title: "Autorizar acesso" })),
}));
vi.mock("@/app/actions/auth/decidirConsentimentoOAuth", () => ({
  decidirConsentimentoOAuthForm: vi.fn(),
}));

const AUTH_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const getUser = vi.fn();
const getAuthorizationDetails = vi.fn();

describe("tela /oauth/consent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser,
        oauth: { getAuthorizationDetails },
      },
    } as never);
  });

  it("sem login redireciona para o login com next", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { default: Page } = await import("./page");
    await expect(
      Page({ searchParams: Promise.resolve({ authorization_id: AUTH_ID }) }),
    ).rejects.toThrow(`REDIRECT:/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${AUTH_ID}`)}`);
    expect(getAuthorizationDetails).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalled();
  });

  it("authorization_id inválido mostra erro e não chama o Auth", async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({ authorization_id: "nao-e-uuid" }) }),
    );
    expect(html).toContain("Este pedido de autorização não é válido ou já expirou.");
    expect(getAuthorizationDetails).not.toHaveBeenCalled();
  });

  it("com sessão mostra client, escopos e o usuário", async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    getAuthorizationDetails.mockResolvedValue({
      data: {
        authorization_id: AUTH_ID,
        client: { id: "cccccccc-0000-4000-8000-000000000001", name: "Bot de leitura" },
        user: { id: USER_ID, email: "pessoa@example.invalid" },
        scope: "buscar ler baixar",
      },
      error: null,
    });
    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({ authorization_id: AUTH_ID }) }),
    );
    expect(html).toContain("Bot de leitura");
    expect(html).toContain("pessoa@example.invalid");
    expect(html).toContain("Listar conversas da conta empresarial");
    expect(html).toContain("Ler conversas da conta empresarial");
    expect(html).toContain("Baixar anexos da conta empresarial");
    expect(html).toContain("Permitir");
    expect(html).toContain("Recusar");
  });
});
