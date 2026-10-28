import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fichaVazia, pessoaVazia } from "@/lib/locacao/ficha-schema";

const mocks = vi.hoisted(() => ({
  role: vi.fn(), support: vi.fn(), rate: vi.fn(), client: vi.fn(), admin: vi.fn(),
  deps: vi.fn(), pool: vi.fn(), gerar: vi.fn(), enriquecer: vi.fn(),
  lerAtual: vi.fn(), gravar: vi.fn(), historico: vi.fn(), lerVersao: vi.fn(), audit: vi.fn(),
  visao: vi.fn(),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mocks.support }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/agent-engine/agent/request-deps", () => ({ requestTurnDeps: mocks.deps }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: mocks.pool }));
vi.mock("@/lib/agent-engine/agent/painel-relatorio-preliminar", async () => {
  const real = await vi.importActual<typeof import("@/lib/agent-engine/agent/painel-relatorio-preliminar")>(
    "@/lib/agent-engine/agent/painel-relatorio-preliminar",
  );
  return { ...real, gerarRelatorioPreliminarNoPainel: mocks.gerar };
});
vi.mock("@/lib/agent-engine/agent/painel-leitura-anexos", async () => {
  const real = await vi.importActual<typeof import("@/lib/agent-engine/agent/painel-leitura-anexos")>(
    "@/lib/agent-engine/agent/painel-leitura-anexos",
  );
  return { ...real, enriquecerAnexosDaAnalise: mocks.enriquecer };
});
vi.mock("@/lib/ai/visao/ler-documento", () => ({ lerDocumentoPorVisao: mocks.visao }));
vi.mock("@/lib/locacao/ficha-repositorio", async () => {
  const real = await vi.importActual<typeof import("@/lib/locacao/ficha-repositorio")>(
    "@/lib/locacao/ficha-repositorio",
  );
  return {
    ...real,
    lerFichaAtual: mocks.lerAtual,
    gravarVersaoDaFicha: mocks.gravar,
    listarHistoricoDaFicha: mocks.historico,
    lerVersaoDaFicha: mocks.lerVersao,
  };
});
vi.mock("@/lib/mcp/servidor-externo/chamada", () => ({
  chamarFerramentaRemota: () => { throw new Error("hub_nao_deve_ser_chamado"); },
}));

import { GET, POST } from "@/app/api/v1/conversations/[id]/painel-agente/ficha/route";

const ctx = { params: Promise.resolve({ id: "conversa-1" }) };
const req = (body: unknown, method = "POST") => new NextRequest("http://localhost/api/v1/conversations/conversa-1/painel-agente/ficha", {
  method, body: method === "GET" ? undefined : JSON.stringify(body),
  headers: { "content-type": "application/json" },
});

function fichaComInquilino() {
  const ficha = fichaVazia();
  ficha.pessoas = [{
    ...pessoaVazia("inquilino"),
    principal: true,
    nome: { valor: "Maria", fonte: "M1", trecho: "Maria", confianca: 0.9, message_id: null },
    celular: { valor: "11977776666", fonte: "M1", trecho: "11977776666", confianca: 0.8, message_id: null },
  }];
  return ficha;
}

describe("rota da ficha preliminar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.support.mockResolvedValue(null);
    mocks.role.mockResolvedValue({ ok: true, user: { id: "user-1", idioma: "pt-BR" }, org: { orgId: "org-1" } });
    mocks.rate.mockResolvedValue({ allowed: true });
    mocks.deps.mockReturnValue({ llmCfg: {}, registry: {}, log: {} });
    mocks.enriquecer.mockResolvedValue({ linhas: [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", type: "text", body: "Maria 11977776666", direction: "inbound" }], avisos: [] });
    mocks.gerar.mockResolvedValue({ saida: { relatorio: "Maria quer o apto 10.", ficha: fichaComInquilino() }, callId: "c1" });
    mocks.lerAtual.mockResolvedValue(null);
    mocks.historico.mockResolvedValue([]);
    mocks.gravar.mockImplementation(async (_admin: unknown, input: { ficha: unknown; relatorio: string; origem: string }) => ({
      id: "linha-1", versao: 1, base_versao: 0, origem: input.origem, ficha: input.ficha,
      relatorio: input.relatorio, campos_alterados: ["*"], alterado_por: "user-1", alterado_em: "2026-10-28T00:00:00Z",
    }));
    const from = (table: string) => {
      const q = {
        select: () => q, eq: () => q, order: () => q,
        limit: () => Promise.resolve({ data: table === "messages" ? [] : null, error: null }),
        maybeSingle: async () => ({
          data: table === "conversations"
            ? { id: "conversa-1", contact_id: "contato-1" }
            : table === "contacts"
              ? { id: "contato-1", is_anonymized: false }
              : { settings: {} },
          error: null,
        }),
      };
      return q;
    };
    mocks.client.mockResolvedValue({ from });
    mocks.admin.mockReturnValue({});
  });

  it("gera o relatório sem chamar Hub, FC ou contrato", async () => {
    const r = await POST(req({ etapa: "gerar" }), ctx);
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.data.relatorio).toContain("Maria");
    expect(corpo.data.ficha.pessoas[0].papel).toBe("inquilino");
    expect(mocks.gerar).toHaveBeenCalled();
    expect(mocks.gravar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ origem: "preliminar_ia" }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toMatch(/11977776666|Maria quer/);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "ai.painel_atendente.ficha_preliminar",
      metadata: expect.objectContaining({ sucesso: true, campos: ["*"] }),
    }));
  });

  it("salva correção do atendente sem valores no audit", async () => {
    const ficha = fichaComInquilino();
    const r = await POST(req({ etapa: "salvar", ficha, relatorio: "Texto conferido.", base_versao: 1 }), ctx);
    expect(r.status).toBe(200);
    expect(mocks.gravar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      origem: "atendente", baseVersao: 1, relatorio: "Texto conferido.",
    }));
    expect(JSON.stringify(mocks.audit.mock.calls[0][0].metadata)).not.toMatch(/11977776666|Texto conferido/);
  });

  it("GET devolve a ficha atual sem gerar de novo", async () => {
    mocks.lerAtual.mockResolvedValue({
      versao: 2, origem: "atendente", ficha: fichaComInquilino(), relatorio: "ok",
      campos_alterados: ["pessoas[0].celular"], alterado_em: "2026-10-28T00:00:00Z",
    });
    const r = await GET(req(null, "GET"), ctx);
    expect(r.status).toBe(200);
    expect(mocks.gerar).not.toHaveBeenCalled();
    expect((await r.json()).data.atual.versao).toBe(2);
  });

  it("o fonte da rota não importa Hub, FC nem /contrato/confirmar", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("app/api/v1/conversations/[id]/painel-agente/ficha/route.ts", "utf8");
    expect(src).not.toMatch(/chamarFerramentaRemota|iniciar_analise_inquilino|confirmar-cobranca|\/contrato\/confirmar/);
  });

  it("suporte só leitura não grava", async () => {
    mocks.support.mockResolvedValue(new Response("no", { status: 403 }));
    const r = await POST(req({ etapa: "gerar" }), ctx);
    expect(r.status).toBe(403);
    expect(mocks.gerar).not.toHaveBeenCalled();
  });
});
