import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ContratoModule from "@/lib/agent-engine/agent/painel-contrato";

const m = vi.hoisted(() => ({ role: vi.fn(), support: vi.fn(), rate: vi.fn(), db: vi.fn(),
  load: vi.fn(), call: vi.fn(), audit: vi.fn(), eq: vi.fn(), conversa: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: m.role }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: m.support }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: m.rate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/mcp/servidor-externo/carregar", () => ({ carregarServidorMcpExterno: m.load }));
vi.mock("@/lib/audit", () => ({ audit: m.audit }));
vi.mock("@/lib/env", () => ({ env: { INTERNAL_SECRET: "segredo-de-teste" } }));
vi.mock("@/lib/agent-engine/agent/painel-contrato", async (original) => ({
  ...await original<typeof ContratoModule>(), chamarApiContrato: m.call,
}));

import { POST } from "@/app/api/v1/conversations/[id]/painel-agente/contrato/route";
const dados = { imovel: { endereco: "Rua teste" }, locatarios: [{ cpf: "52998224725" }], aluguel: 1200,
  data_inicio: "2026-12-01", dia_vencimento: 10, tipo: "residencial", indice_reajuste: "IPCA", garantia: "nenhuma" };
const pedido = (body: unknown) => new NextRequest("http://localhost/api/v1/conversations/c1/painel-agente/contrato", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
});
const ctx = { params: Promise.resolve({ id: "c1" }) };
async function preparar() {
  const r = await POST(pedido({ etapa: "preparar", dados }), ctx);
  expect(r.status).toBe(200);
  return (await r.json()).data.token as string;
}

describe("rota de criação da locação", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.support.mockResolvedValue(null);
    m.role.mockResolvedValue({ ok: true, user: { id: "u1", idioma: "pt-BR" }, org: { orgId: "org1" } });
    m.rate.mockResolvedValue({ allowed: true });
    m.conversa.mockReturnValue({ contact_id: "p1" });
    m.db.mockResolvedValue({ from: (table: string) => {
      const q = { select: () => q, eq: (k: string, v: string) => { m.eq(table, k, v); return q; },
        maybeSingle: async () => ({ data: table === "conversations" ? m.conversa() : { id: "p1", is_anonymized: false } }) };
      return q;
    } });
    m.load.mockResolvedValue({ servidor: { endpoint: "https://hub.example/mcp", chave: "segredo-hub" } });
    m.call.mockResolvedValue({ pronto: true, preview_id: "ab".repeat(18), resumo: { texto: "Prévia completa" },
      pendencias: [], avisos: [], validade_s: 1800 });
  });

  it("prepara sem confirmar e usa o escopo autenticado sem auditar dados pessoais", async () => {
    const token = await preparar();
    expect(token).toEqual(expect.any(String));
    expect(m.call).toHaveBeenCalledWith(expect.anything(), "preparar", dados);
    expect(m.eq).toHaveBeenCalledWith("conversations", "organization_id", "org1");
    expect(m.eq).toHaveBeenCalledWith("contacts", "organization_id", "org1");
    expect(m.role).toHaveBeenCalledWith("agent", expect.anything());
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain("52998224725");
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain("Prévia completa");
  });

  it("repete a mesma chave no Hub após resposta perdida", async () => {
    const token = await preparar();
    m.call.mockRejectedValueOnce(new Error("resposta perdida"))
      .mockResolvedValueOnce({ gravado: true, completo: false, id_contrato: "358", acoes_manuais: ["Pausar pela tela"] });
    const body = { etapa: "confirmar", token, confirmado: true };
    expect((await POST(pedido(body), ctx)).status).toBe(502);
    const r = await POST(pedido(body), ctx);
    expect(r.status).toBe(200);
    expect((await r.json()).data).toMatchObject({ gravado: true, completo: false, id_contrato: "358" });
    expect(m.call.mock.calls[1]).toEqual(m.call.mock.calls[2]);
    expect(m.call.mock.calls[1]![2]).toMatchObject({ preview_id: "ab".repeat(18), confirmado: true, idempotency_key: expect.any(String) });
  });

  it("recusa prévia de outra organização ou conversa antes de chamar confirmação", async () => {
    const token = await preparar();
    m.call.mockClear();
    const r = await POST(pedido({ etapa: "confirmar", token, confirmado: true }), { params: Promise.resolve({ id: "c2" }) });
    expect(r.status).toBe(409);
    m.role.mockResolvedValue({ ok: true, user: { id: "u1", idioma: "pt-BR" }, org: { orgId: "org2" } });
    expect((await POST(pedido({ etapa: "confirmar", token, confirmado: true }), ctx)).status).toBe(409);
    expect(m.call).not.toHaveBeenCalled();
  });

  it("pendências do Hub impedem emitir token de confirmação", async () => {
    m.call.mockResolvedValueOnce({ pronto: true, preview_id: "ab".repeat(18), resumo: { texto: "Prévia" }, pendencias: ["Falta conta de repasse"] });
    expect(await preparar()).toBeNull();
  });

  it("suporte só leitura, falta de confirmação e conversa inacessível impedem a chamada", async () => {
    m.support.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect((await POST(pedido({ etapa: "preparar", dados }), ctx)).status).toBe(403);
    expect((await POST(pedido({ etapa: "confirmar", token: "x" }), ctx)).status).toBe(400);
    m.conversa.mockReturnValueOnce(null);
    expect((await POST(pedido({ etapa: "preparar", dados }), ctx)).status).toBe(404);
    expect(m.call).not.toHaveBeenCalled();
  });
});
