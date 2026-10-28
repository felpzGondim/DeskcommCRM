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

import { POST } from "@/app/api/v1/conversations/[id]/painel-agente/relatorio/route";

const ctx = { params: Promise.resolve({ id: "conversa-1" }) };
const req = (body: unknown) =>
  new NextRequest("http://localhost/api/v1/conversations/conversa-1/painel-agente/relatorio", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

describe("rota do relatório financeiro", () => {
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
      texto: "Relatório financeiro gerado.",
      extra: { risco: "moderado" },
    });
  });

  it("gerar e aprovar passam por executarFerramenta com origem botao", async () => {
    const gerar = await POST(req({ etapa: "gerar" }), ctx);
    expect(gerar.status).toBe(200);
    expect(mocks.executar).toHaveBeenCalledWith(
      "gerar_relatorio",
      expect.objectContaining({ origem: "botao" }),
      expect.any(Object),
    );
    const aprovar = await POST(req({ etapa: "aprovar" }), ctx);
    expect(aprovar.status).toBe(200);
    expect(mocks.executar).toHaveBeenCalledWith(
      "aprovar_relatorio",
      expect.objectContaining({ origem: "botao" }),
      expect.any(Object),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "locacao.relatorio_rascunho" }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "locacao.relatorio_aprovado" }),
    );
  });

  it("a tela some quando a chave está desligada; não recomenda alugar", () => {
    const painel = readFileSync("components/locacao/ProcessoDeLocacaoPainel.tsx", "utf8");
    expect(painel).toContain("analiseRelatorio");
    expect(painel).toContain('data-testid="analise-relatorio"');
    expect(painel).not.toMatch(/n[aã]o alugue|\balugue\b/i);
    const config = readFileSync("components/locacao/PainelConfigLocacao.tsx", "utf8");
    expect(config).toContain("Ligar relatório financeiro (desligado por padrão)");
    const rota = readFileSync("app/api/v1/conversations/[id]/painel-agente/relatorio/route.ts", "utf8");
    expect(rota).not.toMatch(/chamarFerramentaRemota|iniciar_analise_inquilino/);
  });
});
