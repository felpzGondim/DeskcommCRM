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
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mocks.support }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/painel/ferramentas/executar", () => ({ executarFerramenta: mocks.executar }));
vi.mock("@/lib/mcp/servidor-externo/chamada", () => ({
  chamarFerramentaRemota: () => {
    throw new Error("hub_nao_deve_ser_chamado");
  },
}));

import { POST } from "@/app/api/v1/conversations/[id]/painel-agente/renda/route";

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
      texto: "Renda comprovada: R$ 4000.00.",
      extra: { versao: 1 },
    });
  });

  it("analisar e confirmar passam por executarFerramenta com origem botao", async () => {
    const analisar = await POST(req({ etapa: "analisar" }), ctx);
    expect(analisar.status).toBe(200);
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
  });
});
