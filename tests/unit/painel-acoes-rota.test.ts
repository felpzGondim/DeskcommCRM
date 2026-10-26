import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  role: vi.fn(), support: vi.fn(), rate: vi.fn(), client: vi.fn(), admin: vi.fn(),
  load: vi.fn(), call: vi.fn(), idem: vi.fn(), audit: vi.fn(), ultimaMensagem: vi.fn(),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mocks.support }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/mcp/servidor-externo/carregar", () => ({ carregarServidorMcpExterno: mocks.load }));
vi.mock("@/lib/mcp/servidor-externo/chamada", () => ({ chamarFerramentaRemota: mocks.call }));
vi.mock("@/lib/api/idempotency", () => ({ comIdempotencia: mocks.idem }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { POST } from "@/app/api/v1/conversations/[id]/painel-agente/acoes/route";

const pedidoId = "fd9997f2-b3b1-48fd-82b6-f24445017a53";
const ctx = { params: Promise.resolve({ id: "conversa-1" }) };
const req = (body: unknown) => new NextRequest("http://localhost/api/v1/conversations/conversa-1/painel-agente/acoes", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
});

describe("rota das ações do painel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.support.mockResolvedValue(null);
    mocks.role.mockResolvedValue({ ok: true, user: { id: "user-1", idioma: "pt-BR" }, org: { orgId: "org-1" } });
    mocks.rate.mockResolvedValue({ allowed: true });
    mocks.ultimaMensagem.mockReturnValue({ body: "123", sent_at: new Date().toISOString() });
    const from = (table: string) => {
      const q = {
        select: () => q, eq: () => q, is: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: table === "conversations"
          ? { id: "conversa-1", contact_id: "contato-1" }
          : table === "contacts"
            ? { id: "contato-1", is_anonymized: false, phone_number: "+5511999999999" }
            : mocks.ultimaMensagem(), error: null }),
      };
      return q;
    };
    mocks.client.mockResolvedValue({ from });
    mocks.admin.mockReturnValue({});
    mocks.load.mockResolvedValue({ servidor: { endpoint: "https://hub.test/mcp", chave: "secret" },
      cabecalhos: { "X-Deskcomm-Contato-Id": "contato-1" },
      ferramentas: [{ name: "segunda_via_boleto", somenteLeitura: true }, { name: "brisa_hub_analise", inputSchema: { properties: { pedido_id: {}, conversa_id: {} } } }],
    });
    mocks.call.mockResolvedValue({ dados: { boletos: [] }, texto: "" });
  });

  it("mantém autorização e escopo de conversa por organização", async () => {
    const r = await POST(req({ acao: "boletos" }), ctx);
    expect(r.status).toBe(200);
    expect(mocks.role).toHaveBeenCalledWith("agent", expect.any(Object));
    expect(mocks.load).toHaveBeenCalledWith(expect.anything(), "org-1", expect.objectContaining({ contatoDoTurno: "contato-1" }));
    expect(mocks.call).toHaveBeenCalledWith(expect.anything(), "segunda_via_boleto", { tres_primeiros_digitos_cpf: "123" }, expect.anything());
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "ai.painel_atendente.boletos" }));
  });

  it("sem resposta de três dígitos do cliente só sugere texto no Composer", async () => {
    mocks.ultimaMensagem.mockReturnValue({ body: "Quero a 2ª via", sent_at: new Date().toISOString() });
    const r = await POST(req({ acao: "boletos" }), ctx);
    expect(r.status).toBe(200);
    expect(JSON.stringify(await r.json())).toContain("três primeiros dígitos");
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("não chama o Hub sem confirmação e pedido válido", async () => {
    const r = await POST(req({ acao: "analise", pedidoId }), ctx);
    expect(r.status).toBe(400);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("consulta contrato e inquilino em duas ferramentas de leitura", async () => {
    mocks.load.mockResolvedValue({ servidor: {}, cabecalhos: {}, ferramentas: [
      { name: "buscar_contrato", somenteLeitura: true },
      { name: "buscar_inquilino", somenteLeitura: true },
    ] });
    mocks.call.mockResolvedValueOnce({ dados: { contrato: { imovel: "Rua A", valor: 1000, vencimento: "2026-11-05", situacao: "ativo" } } })
      .mockResolvedValueOnce({ dados: { situacao: "ativo" } });
    const r = await POST(req({ acao: "contrato" }), ctx);
    expect(r.status).toBe(200);
    expect(mocks.call.mock.calls.map((call: unknown[]) => call[1])).toEqual(["buscar_contrato", "buscar_inquilino"]);
    expect(JSON.stringify(await r.json())).toContain("Rua A");
  });

  it("reserva análise por conversa e pedido e respeita replay", async () => {
    mocks.idem.mockImplementation(async (v: { executar: () => Promise<{ resposta: unknown; status: number }>; endpoint: string; chave: string }) => {
      expect(v.endpoint).toContain("conversa-1");
      expect(v.chave).toBe(pedidoId);
      const feito = await v.executar();
      return { tipo: "executou", ...feito };
    });
    const r = await POST(req({ acao: "analise", confirmar: true, pedidoId }), ctx);
    expect(r.status).toBe(200);
    expect(mocks.call).toHaveBeenCalledWith(expect.anything(), "brisa_hub_analise", { pedido_id: pedidoId, conversa_id: "conversa-1" }, expect.anything());
    mocks.call.mockClear();
    mocks.idem.mockResolvedValue({ tipo: "replay", resposta: { resumo: "Pedido de análise enviado." }, status: 200 });
    const repetido = await POST(req({ acao: "analise", confirmar: true, pedidoId }), ctx);
    expect(repetido.status).toBe(200);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("ferramenta ausente vira mensagem clara", async () => {
    mocks.load.mockResolvedValue({ servidor: {}, ferramentas: [] });
    const r = await POST(req({ acao: "boletos" }), ctx);
    expect(r.status).toBe(422);
    expect(JSON.stringify(await r.json())).toContain("ferramenta não disponível");
  });
});
