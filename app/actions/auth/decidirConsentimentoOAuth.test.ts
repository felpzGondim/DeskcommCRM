import { beforeEach, describe, expect, it, vi } from "vitest";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  audit: vi.fn(async () => undefined),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const AUTH_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const REDIRECT = "http://127.0.0.1/callback?code=abc";

const approveAuthorization = vi.fn();
const denyAuthorization = vi.fn();
const getAuthorizationDetails = vi.fn();
const getUser = vi.fn();

function form(decisao: string, authorizationId: string = AUTH_ID): FormData {
  const f = new FormData();
  f.set("decisao", decisao);
  f.set("authorization_id", authorizationId);
  return f;
}

describe("decidirConsentimentoOAuthForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(headers).mockResolvedValue({
      get: (k: string) => (k === "x-request-id" ? "req-teste" : null),
    } as never);
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser,
        oauth: { getAuthorizationDetails, approveAuthorization, denyAuthorization },
      },
    } as never);
  });

  it("aprovar redireciona para o redirect_url do Auth", async () => {
    approveAuthorization.mockResolvedValue({ data: { redirect_url: REDIRECT }, error: null });
    const { decidirConsentimentoOAuthForm } = await import("./decidirConsentimentoOAuth");
    await expect(decidirConsentimentoOAuthForm(form("aprovar"))).rejects.toThrow(`REDIRECT:${REDIRECT}`);
    expect(approveAuthorization).toHaveBeenCalledWith(AUTH_ID, { skipBrowserRedirect: true });
    expect(denyAuthorization).not.toHaveBeenCalled();
    expect(vi.mocked(audit).mock.calls[0]?.[0]).toMatchObject({
      action: "oauth.consent_approved",
      resourceId: AUTH_ID,
    });
    expect(JSON.stringify(vi.mocked(audit).mock.calls[0]?.[0])).not.toMatch(/@/);
  });

  it("negar redireciona para o redirect_url do Auth", async () => {
    denyAuthorization.mockResolvedValue({
      data: { redirect_url: "http://127.0.0.1/callback?error=access_denied" },
      error: null,
    });
    const { decidirConsentimentoOAuthForm } = await import("./decidirConsentimentoOAuth");
    await expect(decidirConsentimentoOAuthForm(form("negar"))).rejects.toThrow(
      "REDIRECT:http://127.0.0.1/callback?error=access_denied",
    );
    expect(denyAuthorization).toHaveBeenCalledWith(AUTH_ID, { skipBrowserRedirect: true });
    expect(approveAuthorization).not.toHaveBeenCalled();
  });

  it("sem login manda para /login com next do consentimento", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { decidirConsentimentoOAuthForm } = await import("./decidirConsentimentoOAuth");
    await expect(decidirConsentimentoOAuthForm(form("aprovar"))).rejects.toThrow(
      /REDIRECT:\/login\?next=/,
    );
    expect(approveAuthorization).not.toHaveBeenCalled();
  });

  it("authorization_id inválido não chama o Auth", async () => {
    const { decidirConsentimentoOAuthForm } = await import("./decidirConsentimentoOAuth");
    await expect(decidirConsentimentoOAuthForm(form("aprovar", "nao-e-uuid"))).rejects.toThrow(
      "REDIRECT:/oauth/consent?erro=1",
    );
    expect(approveAuthorization).not.toHaveBeenCalled();
    expect(denyAuthorization).not.toHaveBeenCalled();
  });
});
