import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const postMock = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiClient: { post: (...args: unknown[]) => postMock(...args) as Promise<unknown> },
}));

import { PainelDoAgente } from "@/components/inbox/PainelDoAgente";

describe("Painel do agente (UI)", () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  it("sugerir resposta → 'Usar como resposta' só preenche, não envia", async () => {
    postMock.mockResolvedValue({ data: { acao: "sugerir", resposta: "Olá! Posso ajudar?" } });
    const usar = vi.fn();
    render(<PainelDoAgente conversationId="c1" onUsarComoResposta={usar} />);
    fireEvent.click(screen.getByRole("button", { name: "Sugerir resposta" }));
    await screen.findByText("Olá! Posso ajudar?");
    expect(postMock).toHaveBeenCalledWith(
      "/api/v1/conversations/c1/painel-agente",
      expect.objectContaining({ acao: "sugerir", historico: [] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Usar como resposta" }));
    expect(usar).toHaveBeenCalledWith("Olá! Posso ajudar?");
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("resumo não oferece 'Usar como resposta'", async () => {
    postMock.mockResolvedValue({ data: { acao: "resumir", resposta: "Cliente quer alugar." } });
    render(<PainelDoAgente conversationId="c1" onUsarComoResposta={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Resumir conversa" }));
    await screen.findByText("Cliente quer alugar.");
    expect(screen.queryByRole("button", { name: "Usar como resposta" })).toBeNull();
  });

  it("erro aparece na tela", async () => {
    postMock.mockImplementation(async () => {
      throw new Error("Nenhum provedor de IA está configurado.");
    });
    render(<PainelDoAgente conversationId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Resumir conversa" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByRole("alert")).toHaveTextContent("Nenhum provedor");
  });

  it("só leitura desabilita os botões", () => {
    render(<PainelDoAgente conversationId="c1" desabilitado />);
    expect(screen.getByRole("button", { name: "Resumir conversa" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Buscar boletos" })).toBeDisabled();
  });

  it("análise exige confirmação antes de chamar a rota", async () => {
    postMock.mockResolvedValue({ data: { resumo: "Pedido de análise enviado." } });
    render(<PainelDoAgente conversationId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar análise de inquilino" }));
    expect(postMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar análise" }));
    await screen.findByText("Pedido de análise enviado.");
    expect(postMock).toHaveBeenCalledWith(
      "/api/v1/conversations/c1/painel-agente/acoes",
      expect.objectContaining({ acao: "analise", confirmar: true, pedidoId: expect.any(String) }),
    );
  });

  it("pedido de documentos só preenche o Composer", async () => {
    postMock.mockResolvedValue({ data: { resumo: "Pendentes", sugestao: "Envie o RG, por favor." } });
    const preencher = vi.fn();
    render(<PainelDoAgente conversationId="c1" onUsarComoResposta={preencher} />);
    fireEvent.click(screen.getByRole("button", { name: "Ficha cadastral / pedir documentos" }));
    await screen.findByText("Envie o RG, por favor.");
    fireEvent.click(screen.getByRole("button", { name: "Usar como resposta" }));
    expect(preencher).toHaveBeenCalledWith("Envie o RG, por favor.");
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});
