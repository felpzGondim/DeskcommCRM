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

import { POST } from "@/app/api/v1/conversations/[id]/painel-agente/manual/route";

const ctx = { params: Promise.resolve({ id: "conversa-1" }) };
const req = (body: unknown) =>
  new NextRequest("http://localhost/api/v1/conversations/conversa-1/painel-agente/manual", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

describe("rota do manual assistido no painel", () => {
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
      texto: "Passo a passo pronto. Copie os dados e faça no site. O CPF continua mascarado até você revelar.",
      extra: { etapa_fc: true },
    });
  });

  it("preparar, revelar e registrar passam por executarFerramenta com origem botao", async () => {
    const preparar = await POST(req({ etapa: "preparar" }), ctx);
    expect(preparar.status).toBe(200);
    expect(mocks.executar).toHaveBeenCalledWith(
      "preparar_manual",
      expect.objectContaining({ origem: "botao" }),
      expect.any(Object),
    );
    expect(mocks.audit).not.toHaveBeenCalled();

    mocks.executar.mockResolvedValue({
      ok: true,
      texto: "CPF revelado só nesta tela. Não fica no histórico da conversa.",
      extra: { cpf: "52998224725" },
    });
    const revelar = await POST(req({ etapa: "revelar_cpf" }), ctx);
    expect(revelar.status).toBe(200);
    expect(mocks.executar).toHaveBeenCalledWith(
      "revelar_cpf_manual",
      expect.objectContaining({ origem: "botao" }),
      expect.any(Object),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "locacao.cpf_revelado" }),
    );

    mocks.executar.mockResolvedValue({
      ok: true,
      texto: "Resultado da FC registrado pelo atendente.",
      extra: { pedido_id: "p1", estado: "concluida" },
    });
    const registrar = await POST(req({ etapa: "registrar_fc", score: 10, risco: "baixo" }), ctx);
    expect(registrar.status).toBe(200);
    expect(mocks.executar).toHaveBeenCalledWith(
      "registrar_manual_fc",
      expect.objectContaining({ origem: "botao" }),
      expect.objectContaining({ score: 10, risco: "baixo" }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "locacao.analise_manual_fc" }),
    );
    const auditado = JSON.stringify(mocks.audit.mock.calls);
    expect(auditado).not.toMatch(/52998224725|529\.982|@exemplo/i);
    expect(auditado).not.toContain("cpf_formatado");
  });

  it("a tela e a config ficam atrás da chave; sem passo pago e sem Contratar", () => {
    const painel = readFileSync("components/locacao/ProcessoDeLocacaoPainel.tsx", "utf8");
    expect(painel).toContain("analiseManual");
    expect(painel).toContain('data-testid="analise-manual"');
    expect(painel).toContain("Revelar CPF");
    expect(painel).not.toMatch(/confirmar-cobranca-fc|valor_exibido/);
    const bloco = painel.slice(painel.indexOf('data-testid="analise-manual"'));
    expect(bloco).not.toMatch(/R\$|25[,.]30|fc_preco/);
    expect(bloco).toContain("Nunca clique em Contratar");
    const config = readFileSync("components/locacao/PainelConfigLocacao.tsx", "utf8");
    expect(config).toContain("Ligar manual assistido (desligado por padrão)");
    const acoes = readFileSync("lib/painel/acoes/manual.ts", "utf8");
    expect(acoes).not.toMatch(/chamarIniciar|chamarConfirmar|chamarStatus|chamarBaixar/);
    expect(acoes).toContain('origem: "manual"');
    expect(acoes).toContain("manual_assistido");
  });
});
