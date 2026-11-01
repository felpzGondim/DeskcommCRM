import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({
  apiClient: { post: (...a: unknown[]) => post(...a) },
}));

import { PONTO_RENDA_ASSINCRONA, rodarAbaDoModal } from "@/lib/locacao/acoes-do-modal";

describe("botões do modal chamam as rotas que já existem", () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({ data: {} });
  });

  it("renda ainda é o POST síncrono — ponto de ligação da fila assíncrona", async () => {
    expect(PONTO_RENDA_ASSINCRONA.estado).toBe("sincrono");
    await rodarAbaDoModal({ conversationId: "c1", aba: "renda", processoId: "p1" });
    expect(post).toHaveBeenCalledWith("/api/v1/conversations/c1/painel-agente/renda", {
      etapa: "analisar",
      processo_id: "p1",
      senhasPdf: undefined,
    });
  });

  it("FC, Migra e relatório usam as rotas atuais", async () => {
    await rodarAbaDoModal({ conversationId: "c1", aba: "fc", processoId: "p1" });
    await rodarAbaDoModal({ conversationId: "c1", aba: "migra", processoId: "p1" });
    await rodarAbaDoModal({ conversationId: "c1", aba: "relatorio", processoId: "p1" });
    expect(post).toHaveBeenCalledWith("/api/v1/conversations/c1/painel-agente/fc", {
      etapa: "analisar",
      processo_id: "p1",
    });
    expect(post).toHaveBeenCalledWith("/api/v1/conversations/c1/painel-agente/seguro", {
      etapa: "analisar",
      processo_id: "p1",
    });
    expect(post).toHaveBeenCalledWith("/api/v1/conversations/c1/painel-agente/relatorio", {
      etapa: "gerar",
      processo_id: "p1",
    });
  });
});
