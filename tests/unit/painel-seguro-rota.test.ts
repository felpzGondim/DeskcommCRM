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

import { POST } from "@/app/api/v1/conversations/[id]/painel-agente/seguro/route";

const ctx = { params: Promise.resolve({ id: "conversa-1" }) };
const req = (body: unknown) =>
  new NextRequest("http://localhost/api/v1/conversations/conversa-1/painel-agente/seguro", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

describe("rota da cotação de seguro-fiança", () => {
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
      texto: "Cotação de seguro-fiança iniciada. Acompanhe o status neste painel.",
      extra: { pedido_id: "p1", estado: "cotando" },
    });
  });

  it("analisar e status passam por executarFerramenta com origem botao", async () => {
    const analisar = await POST(req({ etapa: "analisar" }), ctx);
    expect(analisar.status).toBe(200);
    expect(mocks.executar).toHaveBeenCalledWith(
      "analisar_seguro",
      expect.objectContaining({ origem: "botao" }),
      expect.any(Object),
    );
    const status = await POST(req({ etapa: "status", pedido_id: "00000000-0000-4000-8000-000000000099" }), ctx);
    expect(status.status).toBe(200);
    expect(mocks.executar).toHaveBeenCalledWith(
      "status_seguro",
      expect.objectContaining({ origem: "botao" }),
      expect.objectContaining({ pedido_id: "00000000-0000-4000-8000-000000000099" }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "locacao.analise_seguro_aberta" }),
    );
  });

  it("a tela e a config ficam atrás da chave; Contratar não aparece", () => {
    const painel = readFileSync("components/locacao/ProcessoDeLocacaoPainel.tsx", "utf8");
    expect(painel).toContain("analiseSeguro");
    expect(painel).toContain('data-testid="analise-seguro"');
    expect(painel).toContain("15_000");
    const seguroBloco = painel.slice(
      painel.indexOf('data-testid="analise-seguro"'),
      painel.indexOf('data-testid="analise-fc"'),
    );
    expect(seguroBloco).not.toMatch(/\bscore\b|\brisco\b/);
    expect(painel).not.toMatch(/["']Contratar["']/);
    const config = readFileSync("components/locacao/PainelConfigLocacao.tsx", "utf8");
    expect(config).toContain("Ligar cotação de seguro-fiança (desligada por padrão)");
    const acoes = readFileSync("lib/painel/acoes/seguro.ts", "utf8");
    expect(acoes).not.toMatch(/acao:\s*"fc_salvar"/);
    expect(acoes).toContain('acao: "seguro"');
    const antigo = readFileSync("lib/painel/acoes/hub.ts", "utf8");
    expect(antigo).toContain("LISTA_FECHADA_HUB_ANALISE");
    const confirmar = antigo.slice(antigo.indexOf("export async function confirmarAnaliseHub"));
    expect(confirmar).toContain("pedido_id: input.pedidoId");
    expect(confirmar).not.toContain('acao: "seguro"');
    expect(confirmar).not.toContain("fc_salvar");
  });
});
