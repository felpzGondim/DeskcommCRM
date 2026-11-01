import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  support: vi.fn(),
  rate: vi.fn(),
  client: vi.fn(),
  admin: vi.fn(),
  audit: vi.fn(),
  executar: vi.fn(),
  lerExecucao: vi.fn(),
  lerUltima: vi.fn(),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mocks.support }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/painel/ferramentas/executar", () => ({ executarFerramenta: mocks.executar }));
vi.mock("@/lib/locacao/execucoes", () => ({
  lerExecucao: mocks.lerExecucao,
  lerUltimaExecucaoPorAba: mocks.lerUltima,
}));
vi.mock("@/lib/mcp/servidor-externo/chamada", () => ({
  chamarFerramentaRemota: () => {
    throw new Error("hub_nao_deve_ser_chamado");
  },
}));

import { GET, POST } from "@/app/api/v1/conversations/[id]/painel-agente/renda/route";

const ctx = { params: Promise.resolve({ id: "conversa-1" }) };
const req = (body: unknown) =>
  new NextRequest("http://localhost/api/v1/conversations/conversa-1/painel-agente/renda", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

describe("rota da análise de renda", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.support.mockResolvedValue(null);
    mocks.role.mockResolvedValue({
      ok: true,
      user: { id: "user-1", idioma: "pt-BR" },
      org: { orgId: "org-1" },
    });
    mocks.rate.mockResolvedValue({ allowed: true });
    mocks.admin.mockReturnValue({});
    mocks.client.mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "conversa-1", contact_id: "c1" } }),
            }),
            maybeSingle: async () => ({ data: { id: "c1", is_anonymized: false } }),
          }),
        }),
      }),
    });
    mocks.executar.mockResolvedValue({
      ok: true,
      texto: "Análise de renda na fila.",
      extra: { execucao_id: "00000000-0000-4000-8000-0000000000ee", estado: "na_fila", etapa_texto: "na fila" },
    });
  });

  it("analisar enfileira (202) e confirmar passam por executarFerramenta com origem botao", async () => {
    const analisar = await POST(req({ etapa: "analisar" }), ctx);
    expect(analisar.status).toBe(202);
    const corpo = await analisar.json();
    expect(corpo.data.execucao_id).toBe("00000000-0000-4000-8000-0000000000ee");
    expect(corpo.data.estado).toBe("na_fila");
    expect(mocks.executar).toHaveBeenCalledWith(
      "analisar_renda",
      expect.objectContaining({ origem: "botao" }),
      expect.any(Object),
    );
    const confirmar = await POST(req({ etapa: "confirmar", renda_proposta_fc: 4000 }), ctx);
    expect(confirmar.status).toBe(200);
    expect(mocks.executar).toHaveBeenCalledWith(
      "confirmar_renda",
      expect.objectContaining({ origem: "botao" }),
      expect.objectContaining({ renda_proposta_fc: 4000 }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ai.painel_atendente.renda" }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "locacao.renda_confirmada" }),
    );
  });

  it("GET devolve o andamento sem senha", async () => {
    mocks.lerExecucao.mockResolvedValue({
      id: "00000000-0000-4000-8000-0000000000ee",
      aba: "renda",
      estado: "processando",
      etapa_texto: "lendo extrato pág. 12 de 43",
      progresso_atual: 12,
      progresso_total: 43,
      erro_motivo: null,
      entrada_hash: "abc",
      ficha_versao: 1,
      origem: "botao",
      iniciado_em: null,
      terminado_em: null,
      resultado: {
        conversation_id: "conversa-1",
        senhas: { "extrato.pdf": "segredo" },
        checklist: [],
      },
    });
    const get = await GET(
      new NextRequest(
        "http://localhost/api/v1/conversations/conversa-1/painel-agente/renda?execucao_id=00000000-0000-4000-8000-0000000000ee",
      ),
      ctx,
    );
    expect(get.status).toBe(200);
    const corpo = await get.json();
    expect(corpo.data.estado).toBe("processando");
    expect(corpo.data.etapa_texto).toMatch(/12 de 43/);
    expect(JSON.stringify(corpo)).not.toMatch(/segredo/);
  });

  it("a tela some quando a chave está desligada; o botão antigo some só com seguro e fc", () => {
    const painel = readFileSync("components/locacao/ProcessoDeLocacaoPainel.tsx", "utf8");
    expect(painel).toContain("analiseRenda");
    expect(painel).toContain('data-testid="analise-renda"');
    const agente = readFileSync("components/inbox/PainelDoAgente.tsx", "utf8");
    expect(agente).toContain("ACOES_HUB.analise.rotulo");
    expect(agente).toContain("esconderAnaliseAntiga");
    expect(agente).toMatch(/analise\?\.seguro === true && r\.data\?\.analise\?\.fc === true/);
    const hub = readFileSync("lib/agent-engine/agent/painel-acoes-hub.ts", "utf8");
    expect(hub).toContain("Iniciar análise de inquilino");
    const config = readFileSync("components/locacao/PainelConfigLocacao.tsx", "utf8");
    expect(config).toContain("Ligar análise de renda (desligada por padrão)");
    const painelSrc = readFileSync("components/locacao/ProcessoDeLocacaoPainel.tsx", "utf8");
    expect(painelSrc).toContain("renda-etapa");
    expect(painelSrc).toContain("renda-erro");
    expect(painelSrc).toContain("renda-3x");
    expect(painelSrc).not.toMatch(/servidor-externo/);
  });
});
