import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const post = vi.fn();

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/lib/api/client", () => ({
  apiClient: { post: (...args: unknown[]) => post(...args) },
}));

import { ValidarImovelSuperlogica } from "@/components/locacao/ValidarImovelSuperlogica";

describe("ValidarImovelSuperlogica", () => {
  it("um match devolve o locador mascarado", async () => {
    const onLocador = vi.fn();
    post.mockResolvedValue({
      data: {
        status: "ok",
        locador: {
          nome: "Maria Locadora",
          documento_mascarado: "***.***.**7-25",
          contato_mascarado: "(11) *****-4321",
        },
      },
    });
    render(
      <ValidarImovelSuperlogica conversationId="conv-1" onLocador={onLocador} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Validar no Superlógica" }));
    await waitFor(() => expect(onLocador).toHaveBeenCalled());
    expect(onLocador.mock.calls[0]?.[0]).toMatchObject({
      nome: "Maria Locadora",
      documento_mascarado: "***.***.**7-25",
    });
    expect(post).toHaveBeenCalledWith(
      "/api/v1/conversations/conv-1/locacao/pacote-imovel",
      {},
    );
  });

  it("vários candidatos pedem escolha e o segundo POST manda o id", async () => {
    post.mockResolvedValueOnce({
      data: {
        status: "candidatos",
        aviso: "Vários imóveis na Superlógica batem com este endereço. Escolha um na aba Dados.",
        candidatos: [
          { id_imovel: 11, codigo: "A-1", endereco: "Rua Um, 10", cep: "01310-100" },
          { id_imovel: 12, codigo: "A-2", endereco: "Rua Dois, 20", cep: "01311-100" },
        ],
      },
    });
    post.mockResolvedValueOnce({ data: { status: "ok", locador: { nome: "Maria Locadora" } } });
    render(<ValidarImovelSuperlogica conversationId="conv-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Validar no Superlógica" }));
    await screen.findByText("Rua Um, 10 · A-1 · 01310-100");
    fireEvent.click(screen.getByLabelText("Rua Dois, 20 · A-2 · 01311-100"));
    fireEvent.click(screen.getByRole("button", { name: "Usar este imóvel" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      "/api/v1/conversations/conv-1/locacao/pacote-imovel",
      { id_imovel: 12 },
    ));
  });

  it("Hub fora mostra o aviso em português", async () => {
    post.mockResolvedValue({
      data: {
        status: "indisponivel",
        aviso: "A Superlógica está indisponível agora (o Hub ainda não tem este recurso). O locador e os valores da conversa continuam valendo.",
      },
    });
    render(<ValidarImovelSuperlogica conversationId="conv-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Validar no Superlógica" }));
    expect(await screen.findByTestId("aviso-superlogica-imovel")).toHaveTextContent(
      /Hub ainda não tem este recurso/,
    );
  });
});
