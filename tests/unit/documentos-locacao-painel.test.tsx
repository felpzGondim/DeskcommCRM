import {fireEvent, render, screen} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";

const get = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    patch: (...a: unknown[]) => patch(...a),
  },
}));

import {DocumentosLocacaoPainel} from "@/components/locacao/DocumentosLocacaoPainel";
import {GRUPOS_DE_DOCUMENTO, ROTULOS_DO_GRUPO, TEXTO_GRUPO_VAZIO} from "@/lib/locacao/grupo-de-documento";

const conversa = "20000000-0000-4000-8000-000000000001";
const arquivo = "30000000-0000-4000-8000-000000000001";

describe("aba Documentos: grupos e abertura same-origin", () => {
  beforeEach(() => {
    get.mockReset();
    patch.mockReset();
    get.mockResolvedValue({
      data: {
        recebidos: [{
          id: arquivo, origem: "mensagem", origem_arquivo: "anexo_conversa",
          nome: "cadastro.png", categoria: "outro", participante_id: null,
          mime: "image/png", data: "2026-10-29T12:00:00Z", situacao: "Arquivo disponível",
        }],
        documentos: [], participantes: [], pendencias: [], relatorios: [], ha_mais: false,
      },
    });
  });

  it("mostra os cinco grupos na ordem e o vazio combinado", async () => {
    render(<DocumentosLocacaoPainel conversationId={conversa} />);
    expect(await screen.findByText("cadastro.png")).toBeVisible();
    const titulos = screen.getAllByRole("heading", {level: 3}).map((el) => el.textContent);
    expect(titulos.slice(0, 5)).toEqual(GRUPOS_DE_DOCUMENTO.map((g) => ROTULOS_DO_GRUPO[g]));
    expect(screen.getAllByText(TEXTO_GRUPO_VAZIO)).toHaveLength(4);
    expect(screen.getByTestId("documentos-locacao").querySelector('[data-grupo="inquilino"]'))
      .toHaveTextContent("cadastro.png");
  });

  it("abre e baixa com um clique, pela rota assinada da mesma origem", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<DocumentosLocacaoPainel conversationId={conversa} />);
    await screen.findByText("cadastro.png");
    fireEvent.click(screen.getByRole("button", {name: "Abrir"}));
    expect(open).toHaveBeenCalledWith(
      `/api/v1/conversations/${conversa}/locacao/documentos?arquivo=${arquivo}&origem=mensagem&redirect=1`,
      "_blank",
      "noopener,noreferrer",
    );
    fireEvent.click(screen.getByRole("button", {name: "Baixar"}));
    expect(open).toHaveBeenLastCalledWith(
      expect.stringContaining("download=1"),
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });
});
