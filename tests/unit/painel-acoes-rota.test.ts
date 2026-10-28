import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  role: vi.fn(), support: vi.fn(), rate: vi.fn(), client: vi.fn(), admin: vi.fn(),
  load: vi.fn(), call: vi.fn(), idem: vi.fn(), audit: vi.fn(), ultimaMensagem: vi.fn(), linhasFicha: vi.fn(),
  preparar: vi.fn(), deps: vi.fn(), pool: vi.fn(),
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
vi.mock("@/lib/agent-engine/agent/painel-do-atendente", () => ({ prepararAnaliseNoPainel: mocks.preparar }));
vi.mock("@/lib/agent-engine/agent/request-deps", () => ({ requestTurnDeps: mocks.deps }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: mocks.pool }));
vi.mock("@/lib/env", () => ({ env: { INTERNAL_SECRET: "segredo-de-teste-para-a-previa" } }));

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
    mocks.linhasFicha.mockReturnValue([]);
    mocks.deps.mockReturnValue({ llmCfg: {}, registry: {}, log: {} });
    mocks.preparar.mockResolvedValue({ texto: JSON.stringify({
      candidato: { nome: { valor: "Maria", fonte: "M1", trecho: "Maria" }, cpf: { valor: "52998224725", fonte: "M1", trecho: "52998224725" },
        email: { valor: "maria@example.com", fonte: "M1", trecho: "maria@example.com" } },
      imovel: { codigo_fc: { valor: "APT10", fonte: "M1", trecho: "APT10" }, logradouro: { valor: null, fonte: null, trecho: null },
        apartamento: { valor: null, fonte: null, trecho: null }, aluguel: { valor: 1200, fonte: "M1", trecho: "1200" } },
      renda: { mensal: { valor: 4000, fonte: "M2", trecho: "4000" }, documentos: [
        { fonte: "M2", tipo: "holerite", periodo: "10/2026", resumo: "Renda líquida", valor_comprovado: 4000 },
      ] }, pendencias: [],
    }) });
    const from = (table: string) => {
      const q = {
        select: () => q, eq: () => q, is: () => q, order: () => q,
        limit: () => table === "messages"
          ? Promise.resolve({ data: mocks.linhasFicha(), error: null }) : q,
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
      ferramentas: [{ name: "segunda_via_boleto", somenteLeitura: true }, { name: "brisa_hub_analise", inputSchema: { properties: {
        pedido_id: {}, conversa_id: {}, candidato: {}, imovel: {}, renda: {},
      } } }],
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

  it("envia somente a ficha efêmera da conversa ao Hub", async () => {
    mocks.load.mockResolvedValue({ servidor: {}, cabecalhos: {}, ferramentas: [{ name: "buscar_cadastro", somenteLeitura: true }] });
    mocks.linhasFicha.mockReturnValue([{ type: "document", body: "Identidade", metadata: { media_filename: "rg.pdf", media_url: "https://privado.test" }, media_mime: "application/pdf" }]);
    mocks.call.mockResolvedValue({ dados: { documentos_faltantes: ["comprovante de renda"] }, texto: "" });
    const r = await POST(req({ acao: "ficha" }), ctx);
    expect(r.status).toBe(200);
    expect(mocks.call).toHaveBeenCalledWith(expect.anything(), "buscar_cadastro", {
      ficha: { anexos: [{ nome: "rg.pdf", mime: "application/pdf", legenda: "Identidade", conteudo: "" }] },
    }, expect.anything());
    expect(JSON.stringify(await r.json())).toContain("holerite, CTPS ou extrato bancário");
  });

  it("reserva análise por conversa e pedido e respeita replay", async () => {
    mocks.linhasFicha.mockReturnValue([
      { type: "document", body: "", media_derived_status: "ready", media_derived_text: "holerite renda liquida 4000", original_completo: true },
      { type: "text", body: "Maria 52998224725 maria@example.com APT10 aluguel 1200", media_derived_status: null },
    ]);
    const preparo = await POST(req({ acao: "analise", etapa: "preparar" }), ctx);
    expect(preparo.status).toBe(200);
    const corpoPreparo = await preparo.json();
    const previaToken = corpoPreparo.data.previaToken;
    expect(previaToken).toEqual(expect.any(String));
    mocks.call.mockResolvedValue({ dados: { resultado: "aceito" }, texto: "" });
    mocks.idem.mockImplementation(async (v: { executar: () => Promise<{ resposta: unknown; status: number }>; endpoint: string; chave: string }) => {
      expect(v.endpoint).toContain("conversa-1");
      expect(v.chave).toBe(pedidoId);
      const feito = await v.executar();
      return { tipo: "executou", ...feito };
    });
    const r = await POST(req({ acao: "analise", etapa: "confirmar", confirmar: true, pedidoId, previaToken }), ctx);
    expect(r.status).toBe(200);
    expect(mocks.call).toHaveBeenCalledWith(expect.anything(), "brisa_hub_analise", expect.objectContaining({
      pedido_id: pedidoId, conversa_id: "conversa-1", candidato: { nome: "Maria", cpf: "52998224725",
        email: "maria@example.com", telefone: "+5511999999999" },
    }), expect.anything());
    mocks.call.mockClear();
    mocks.idem.mockResolvedValue({ tipo: "replay", resposta: { resumo: "Pedido de análise enviado." }, status: 200 });
    const repetido = await POST(req({ acao: "analise", etapa: "confirmar", confirmar: true, pedidoId, previaToken }), ctx);
    expect(repetido.status).toBe(200);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("invalida a confirmação se a conversa mudou após a prévia", async () => {
    mocks.linhasFicha.mockReturnValue([
      { type: "document", media_derived_status: "ready", media_derived_text: "holerite 4000", original_completo: true },
      { type: "text", body: "Maria 52998224725 maria@example.com APT10 1200" },
    ]);
    const preparo = await POST(req({ acao: "analise", etapa: "preparar" }), ctx);
    const token = (await preparo.json()).data.previaToken;
    expect(token).toEqual(expect.any(String));
    mocks.linhasFicha.mockReturnValue([{ type: "text", body: "Novo documento enviado" }]);
    const confirmacao = await POST(req({ acao: "analise", etapa: "confirmar", confirmar: true,
      pedidoId, previaToken: token }), ctx);
    expect(confirmacao.status).toBe(409);
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("conversa com mais de 200 mensagens analisa a janela útil", async () => {
    mocks.linhasFicha.mockReturnValue(Array.from({ length: 220 }, (_, i) => (
      i === 0
        ? { type: "document", body: "", media_derived_status: "ready", media_derived_text: "holerite renda liquida 4000", original_completo: true }
        : { type: "text", body: i === 1 ? "Maria 52998224725 maria@example.com APT10 aluguel 1200" : "ok" }
    )));
    const r = await POST(req({ acao: "analise", etapa: "preparar" }), ctx);
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.error).toBeUndefined();
    expect(corpo.data.resumo).toContain("Até");
  });

  it("envia URLs assinadas ao Hub só quando a ferramenta anuncia arquivos", async () => {
    mocks.linhasFicha.mockReturnValue([
      { type: "document", body: "", media_derived_status: "ready", media_derived_text: "holerite renda liquida 4000", original_completo: true,
        media_mime: "application/pdf", media_storage_path: "org-1/conversa-1/h.pdf", media_size_bytes: 100,
        metadata: { media_filename: "h.pdf" } },
      { type: "text", body: "Maria 52998224725 maria@example.com APT10 aluguel 1200" },
    ]);
    mocks.admin.mockReturnValue({ storage: { from: () => ({
      download: async () => ({ data: null, error: { message: "skip" } }),
      createSignedUrl: async () => ({ data: { signedUrl: "https://storage.test/h.pdf?s=1" }, error: null }),
    }) } });
    mocks.load.mockResolvedValue({ servidor: {}, cabecalhos: {}, ferramentas: [{ name: "brisa_hub_analise", inputSchema: { properties: {
      pedido_id: {}, conversa_id: {}, candidato: {}, imovel: {}, renda: {}, arquivos: {},
    } } }] });
    const preparo = await POST(req({ acao: "analise", etapa: "preparar" }), ctx);
    const previaToken = (await preparo.json()).data.previaToken;
    expect(previaToken).toEqual(expect.any(String));
    mocks.call.mockResolvedValue({ dados: { resultado: "aceito" }, texto: "" });
    mocks.idem.mockImplementation(async (v: { executar: () => Promise<{ resposta: unknown; status: number }> }) => {
      const feito = await v.executar();
      return { tipo: "executou", ...feito };
    });
    const r = await POST(req({ acao: "analise", etapa: "confirmar", confirmar: true, pedidoId, previaToken }), ctx);
    expect(r.status).toBe(200);
    expect(mocks.call).toHaveBeenCalledWith(expect.anything(), "brisa_hub_analise", expect.objectContaining({
      arquivos: [expect.objectContaining({ nome: "h.pdf", url: "https://storage.test/h.pdf?s=1" })],
    }), expect.anything());
  });

  it("ferramenta ausente vira mensagem clara", async () => {
    mocks.load.mockResolvedValue({ servidor: {}, ferramentas: [] });
    const r = await POST(req({ acao: "boletos" }), ctx);
    expect(r.status).toBe(422);
    const resposta = await r.json();
    expect(resposta.error.code).toBe("tool_unavailable");
    expect(resposta.error.message).toContain("não está disponível no Brisa Hub");
  });
});
