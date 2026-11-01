import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  support: vi.fn(),
  client: vi.fn(),
  admin: vi.fn(),
  lerProcesso: vi.fn(),
  listarParticipantes: vi.fn(),
  mudarStatus: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mocks.support }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/locacao/repositorio", async (importOriginal) => {
  const atual = await importOriginal<typeof import("@/lib/locacao/repositorio")>();
  return {
    ...atual,
    lerProcesso: mocks.lerProcesso,
    listarParticipantes: mocks.listarParticipantes,
    mudarStatus: mocks.mudarStatus,
  };
});

import { PATCH } from "./route";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function pedido(body: unknown) {
  return new NextRequest(`http://localhost/api/v1/locacao/processos/${PROC}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function settingsDaOrg() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { settings: { locacao: { processos_habilitado: true, aprovador_user_ids: [] } } },
          }),
        }),
      }),
    }),
  };
}

function autenticar(orgId: string, role: string) {
  mocks.role.mockResolvedValue({
    ok: true,
    user: { id: USER, idioma: "pt-BR", is_platform_admin: false },
    org: { orgId, role, name: "Org" },
  });
}

describe("PATCH /api/v1/locacao/processos/[id] — aprovar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.support.mockResolvedValue(null);
    mocks.client.mockResolvedValue(settingsDaOrg());
    mocks.admin.mockReturnValue({});
    mocks.listarParticipantes.mockResolvedValue([]);
    mocks.mudarStatus.mockResolvedValue(undefined);
    mocks.audit.mockResolvedValue(undefined);
    autenticar(ORG_A, "agent");
    mocks.lerProcesso.mockResolvedValue({ id: PROC, status: "analise" });
  });

  it("atendente da organização aprova com confirmação, mesmo com aprovador_user_ids vazio", async () => {
    const res = await PATCH(pedido({ acao: "aprovar", confirmado: true }), {
      params: Promise.resolve({ id: PROC }),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ data: { id: PROC, status: "aprovado" } });
    expect(mocks.mudarStatus).toHaveBeenCalledTimes(1);
    expect(mocks.mudarStatus.mock.calls[0]![0]).toEqual({});
    expect(mocks.mudarStatus.mock.calls[0]![1]).toMatchObject({
      orgId: ORG_A,
      processoId: PROC,
      de: "analise",
      para: "aprovado",
      quem: "aprovador",
      userId: USER,
    });
  });

  it("usuário de outra organização é negado e não muda o processo", async () => {
    autenticar(ORG_B, "agent");
    mocks.lerProcesso.mockResolvedValue(null);
    const res = await PATCH(pedido({ acao: "aprovar", confirmado: true }), {
      params: Promise.resolve({ id: PROC }),
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: { code: "not_found" } });
    expect(mocks.mudarStatus).not.toHaveBeenCalled();
  });

  it("sem confirmação não aprova", async () => {
    const res = await PATCH(pedido({ acao: "aprovar" }), {
      params: Promise.resolve({ id: PROC }),
    });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "confirmacao_necessaria" },
    });
    expect(mocks.mudarStatus).not.toHaveBeenCalled();
  });

  it("reabrir também pede confirmação e aceita o atendente da org", async () => {
    mocks.lerProcesso.mockResolvedValue({ id: PROC, status: "reprovado" });
    const sem = await PATCH(pedido({ acao: "reabrir" }), {
      params: Promise.resolve({ id: PROC }),
    });
    expect(sem.status).toBe(409);
    expect(mocks.mudarStatus).not.toHaveBeenCalled();

    const com = await PATCH(pedido({ acao: "reabrir", confirmado: true }), {
      params: Promise.resolve({ id: PROC }),
    });
    expect(com.status).toBe(200);
    await expect(com.json()).resolves.toMatchObject({ data: { status: "documentos" } });
    expect(mocks.mudarStatus).toHaveBeenCalledTimes(1);
  });
});
