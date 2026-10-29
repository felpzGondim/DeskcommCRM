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

import { POST } from "@/app/api/v1/conversations/[id]/painel-agente/fc/route";

const ctx = { params: Promise.resolve({ id: "conversa-1" }) };
const req = (body: unknown) =>
  new NextRequest("http://localhost/api/v1/conversations/conversa-1/painel-agente/fc", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

describe("rota da FC Score+ no painel", () => {
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
      texto: "FC Score+ salva (sem cobrança). Confirme no painel para gastar créditos.",
      extra: { pedido_id: "p1", estado: "aguardando_cobranca" },
    });
  });

  it("analisar, status e confirmar passam por executarFerramenta com origem botao", async () => {
    const analisar = await POST(req({ etapa: "analisar" }), ctx);
    expect(analisar.status).toBe(200);
    expect(mocks.executar).toHaveBeenCalledWith(
      "analisar_fc",
      expect.objectContaining({ origem: "botao" }),
      expect.any(Object),
    );
    const status = await POST(req({ etapa: "status", pedido_id: "00000000-0000-4000-8000-000000000088" }), ctx);
    expect(status.status).toBe(200);
    expect(mocks.executar).toHaveBeenCalledWith(
      "status_fc",
      expect.objectContaining({ origem: "botao" }),
      expect.objectContaining({ pedido_id: "00000000-0000-4000-8000-000000000088" }),
    );
    mocks.executar.mockResolvedValue({
      ok: true,
      texto: "FC Score+ concluída.",
      extra: { pedido_id: "p1", estado: "cobrando" },
    });
    const confirmar = await POST(req({ etapa: "confirmar", pedido_id: "00000000-0000-4000-8000-000000000088" }), ctx);
    expect(confirmar.status).toBe(200);
    expect(mocks.executar).toHaveBeenCalledWith(
      "confirmar_cobranca_fc",
      expect.objectContaining({ origem: "botao" }),
      expect.objectContaining({ pedido_id: "00000000-0000-4000-8000-000000000088" }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "locacao.analise_fc_aberta" }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "locacao.analise_fc_cobrada" }),
    );
    const auditado = JSON.stringify(mocks.audit.mock.calls);
    expect(auditado).not.toMatch(/529|@exemplo|\bcpf\b/i);
  });

  it("a tela e a config ficam atrás da chave; sem preço; confirmação só no clique", () => {
    const painel = readFileSync("components/locacao/ProcessoDeLocacaoPainel.tsx", "utf8");
    expect(painel).toContain("analiseFc");
    expect(painel).toContain('data-testid="analise-fc"');
    expect(painel).toContain("15_000");
    expect(painel).toContain("vai gastar créditos");
    const fcBloco = painel.slice(painel.indexOf('data-testid="analise-fc"'));
    expect(fcBloco).not.toMatch(/R\$|25[,.]30|fc_preco/);
    expect(painel).not.toMatch(/["']Contratar["']/);
    expect(painel).toContain("Pedir FC do fiador");
    const config = readFileSync("components/locacao/PainelConfigLocacao.tsx", "utf8");
    expect(config).toContain("Ligar FC Score+ (desligada por padrão)");
    const acoes = readFileSync("lib/painel/acoes/fc.ts", "utf8");
    expect(acoes).toContain('acao: "fc_salvar"');
    expect(acoes).not.toMatch(/acao:\s*"seguro"/);
    expect(acoes).toContain('origem === "agente"');
    expect(acoes).toContain("vai gastar créditos");
    const hub = readFileSync("lib/painel/acoes/hub.ts", "utf8");
    expect(hub).toContain("NOME_CONFIRMAR_COBRANCA_FC");
    expect(hub).toContain("exigirFerramentasDeFcCobranca");
  });
});
