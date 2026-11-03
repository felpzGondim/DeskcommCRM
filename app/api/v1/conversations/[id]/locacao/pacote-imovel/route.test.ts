import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  support: vi.fn(),
  client: vi.fn(),
  admin: vi.fn(),
  processo: vi.fn(),
  lerFicha: vi.fn(),
  gravarFicha: vi.fn(),
  validar: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mocks.support }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/locacao/ficha-compartilhada", () => ({
  processoAtivoDaConversa: (...args: unknown[]) => mocks.processo(...args),
}));
vi.mock("@/lib/locacao/ficha-repositorio", () => ({
  FichaConflitoDeVersao: class FichaConflitoDeVersao extends Error {},
  lerFichaAtual: (...args: unknown[]) => mocks.lerFicha(...args),
  gravarVersaoDaFicha: (...args: unknown[]) => mocks.gravarFicha(...args),
}));
vi.mock("@/lib/locacao/pacote-do-imovel", () => ({
  validarImovelNoSuperlogica: (...args: unknown[]) => mocks.validar(...args),
}));

import { POST } from "./route";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONV = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function pedido(body: unknown) {
  return new NextRequest(`http://localhost/api/v1/conversations/${CONV}/locacao/pacote-imovel`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /locacao/pacote-imovel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.support.mockResolvedValue(null);
    mocks.role.mockResolvedValue({
      ok: true,
      user: { id: USER, idioma: "pt-BR" },
      org: { orgId: ORG, role: "agent" },
    });
    mocks.client.mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: CONV, contact_id: USER } }),
            }),
            maybeSingle: async () => ({ data: { settings: { locacao: { pacote_superlogica_habilitado: true } } } }),
          }),
        }),
      }),
    });
    mocks.admin.mockReturnValue({});
    mocks.processo.mockResolvedValue({ id: "proc-1", imovel_id: "imovel-1" });
    mocks.lerFicha.mockResolvedValue(null);
    mocks.validar.mockResolvedValue({
      status: "ok",
      aviso: null,
      locador: { nome: "Maria Locadora", documento_mascarado: "***.***.**7-25", contato_mascarado: null },
      ficha: null,
      candidatos: [],
      haMais: false,
      superlogicaImovelId: 77,
      idGravado: true,
      leitura: null,
    });
  });

  it("valida, audita sem PII e devolve o locador mascarado", async () => {
    const r = await POST(pedido({}), { params: Promise.resolve({ id: CONV }) });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.data.status).toBe("ok");
    expect(corpo.data.locador.documento_mascarado).toBe("***.***.**7-25");
    expect(corpo.data.superlogica_imovel_id).toBe(77);
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toMatch(/52998|11987|Maria/);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "locacao.imovel_superlogica_validado",
        metadata: expect.objectContaining({ status: "ok", id_gravado: true, tem_locador: true }),
      }),
    );
  });

  it("support readonly bloqueia a escrita", async () => {
    mocks.support.mockResolvedValue(new Response("no", { status: 403 }));
    const r = await POST(pedido({}), { params: Promise.resolve({ id: CONV }) });
    expect(r.status).toBe(403);
    expect(mocks.validar).not.toHaveBeenCalled();
  });
});
