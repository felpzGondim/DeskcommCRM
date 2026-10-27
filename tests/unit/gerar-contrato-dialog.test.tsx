import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ apiClient: { post } }));
import { GerarContratoDialog } from "@/components/inbox/GerarContratoDialog";

function abrirEPreencher() {
  render(<GerarContratoDialog conversationId="conversa" />);
  fireEvent.click(screen.getByRole("button", { name: "Gerar contrato" }));
  for (const [nome, valor] of [
    ["Endereço do imóvel *", "Rua de teste"], ["Aluguel mensal (R$) *", "1200"],
    ["Início da locação *", "2026-12-01"], ["Dia de vencimento *", "10"], ["CPF *", "529.982.247-25"],
  ] as const) fireEvent.change(screen.getByLabelText(nome), { target: { value: valor } });
  for (const [nome, valor] of [["Tipo de locação *", "residencial"], ["Índice de reajuste *", "IPCA"], ["Garantia *", "nenhuma"]] as const) {
    fireEvent.change(screen.getByLabelText(nome), { target: { value: valor } });
  }
}
const previa = { data: { resumo: "Prévia completa: aluguel, taxas e contrato ATIVO.", pendencias: [], avisos: [], token: "token-assinado" } };

describe("Gerar contrato", () => {
  beforeEach(() => post.mockReset());

  it("prepara, exibe a prévia completa e só confirma após revisão explícita", async () => {
    post.mockResolvedValueOnce(previa).mockResolvedValueOnce({ data: { gravado: true, completo: false,
      id_contrato: "358", situacao: "ATIVO", acoes_manuais: ["Pausar pela tela"], avisos: [], divergencias: ["IPTU pendente"] } });
    abrirEPreencher();
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Preparar locação" }));
    await screen.findByText(previa.data.resumo);
    expect(post).toHaveBeenCalledWith("/api/v1/conversations/conversa/painel-agente/contrato", {
      etapa: "preparar", dados: expect.objectContaining({ aluguel: 1200, indice_reajuste: "IPCA",
        locatarios: [{ cpf: "52998224725", dados: {} }] }),
    }, expect.anything());
    const confirmar = screen.getByRole("button", { name: "Confirmar criação da locação" });
    expect(confirmar).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(confirmar);
    await screen.findByText("Locação criada no SuperLógica.");
    expect(post).toHaveBeenLastCalledWith("/api/v1/conversations/conversa/painel-agente/contrato",
      { etapa: "confirmar", token: "token-assinado", confirmado: true }, expect.anything());
    expect(screen.getByText(/há despesas pendentes/)).toBeInTheDocument();
    expect(screen.getByText("IPTU pendente")).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("alterar dados invalida a confirmação e fechar preserva os campos", async () => {
    post.mockResolvedValue(previa);
    abrirEPreencher();
    fireEvent.click(screen.getByRole("button", { name: "Preparar locação" }));
    await screen.findByText(previa.data.resumo);
    fireEvent.change(screen.getByLabelText("Aluguel mensal (R$) *"), { target: { value: "1300" } });
    expect(screen.queryByRole("button", { name: "Confirmar criação da locação" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Fechar" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Gerar contrato" }));
    expect(screen.getByLabelText("Aluguel mensal (R$) *")).toHaveValue(1300);
  });

  it("timeout mantém a prévia e retoma com o mesmo token sem permitir nova preparação", async () => {
    post.mockResolvedValueOnce(previa).mockRejectedValueOnce(new Error("Conexão interrompida"))
      .mockResolvedValueOnce({ data: { gravado: true, completo: true, id_contrato: "358", acoes_manuais: [], avisos: [], divergencias: [] } });
    abrirEPreencher();
    fireEvent.click(screen.getByRole("button", { name: "Preparar locação" }));
    await screen.findByText(previa.data.resumo);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar criação da locação" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Preparar locação" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Consultar ou retomar confirmação" }));
    await screen.findByText("Locação criada no SuperLógica.");
    expect(post.mock.calls[1]).toEqual(post.mock.calls[2]);
  });

  it("pendências impedem a confirmação", async () => {
    post.mockResolvedValueOnce({ data: { ...previa.data, token: null, pendencias: ["Falta endereço"] } });
    abrirEPreencher();
    fireEvent.click(screen.getByRole("button", { name: "Preparar locação" }));
    await screen.findByText("Falta endereço");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
