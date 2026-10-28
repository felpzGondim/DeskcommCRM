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
  data_inicio: "2026-12-01", dia_vencimento: 10, tipo: "residencial", indice_reajuste: "IPCA", garantia: "nenhuma",
  split: false, isencao_multa_meses: 0 };
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

  it("pendências em objeto {campo, pergunta} também impedem o token e voltam a pergunta", async () => {
    m.call.mockResolvedValueOnce({ pronto: true, preview_id: "ab".repeat(18), resumo: { texto: "Prévia" },
      pendencias: [{ campo: "iptu", pergunta: "Qual o valor mensal do IPTU?" }] });
    const r = await POST(pedido({ etapa: "preparar", dados }), ctx);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.token).toBeNull();
    expect(body.data.pendencias).toEqual([{ campo: "iptu", pergunta: "Qual o valor mensal do IPTU?" }]);
  });

  it("mostra o recado do Hub quando a API de contratos responde 503", async () => {
    const { ErroApiContrato } = await import("@/lib/agent-engine/agent/painel-contrato");
    m.call.mockRejectedValueOnce(new ErroApiContrato("hub_contract_unconfigured", "contrato não configurado"));
    const r = await POST(pedido({ etapa: "preparar", dados }), ctx);
    expect(r.status).toBe(502);
    expect((await r.json()).error.message).toBe("contrato não configurado");
  });

  it("pendência com chaves extras do Hub não derruba a prévia", async () => {
    m.call.mockResolvedValueOnce({ pronto: false, resumo: { texto: "Prévia", itens: [] }, divergencias: [],
      pendencias: [{ campo: "imovel", pergunta: "Contrato não encerrado no imóvel.", tipo: "bloqueio", id_contrato: "9" }] });
    const r = await POST(pedido({ etapa: "preparar", dados }), ctx);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.token).toBeNull();
    expect(body.data.pendencias).toEqual([{ campo: "imovel", pergunta: "Contrato não encerrado no imóvel." }]);
  });

  it("resposta 200 inválida do Hub vira erro tratado com referência e log sem dados pessoais", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    m.call.mockResolvedValueOnce({ pronto: false, pendencias: [{ campo: "cpf", pergunta: 52998224725 }] });
    const r = await POST(pedido({ etapa: "preparar", dados }), ctx);
    expect(r.status).toBe(502);
    const body = await r.json();
    expect(body.error.message).toContain("formato que o painel não reconhece");
    expect(body.error.message).toMatch(/referência: [0-9a-f-]{36}$/);
    expect(body.error.message).not.toContain("Se já confirmou");
    expect(aviso).toHaveBeenCalledTimes(1);
    const linha = String(aviso.mock.calls[0]![0]);
    expect(linha).toContain("ZodError");
    expect(linha).toContain('"caminho":"pendencias.0"');
    expect(linha).not.toContain("52998224725");
    aviso.mockRestore();
  });

  it("falha genérica no preparar não fala em confirmação; no confirmar mantém o recado", async () => {
    m.call.mockRejectedValueOnce(new Error("rede caiu"));
    const r = await POST(pedido({ etapa: "preparar", dados }), ctx);
    expect(r.status).toBe(502);
    expect((await r.json()).error.message).not.toContain("Se já confirmou");
    const token = await preparar();
    m.call.mockRejectedValueOnce(new Error("rede caiu"));
    const c = await POST(pedido({ etapa: "confirmar", token, confirmado: true }), ctx);
    expect((await c.json()).error.message).toContain("Se já confirmou");
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
