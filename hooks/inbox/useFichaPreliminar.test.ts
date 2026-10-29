import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postMock = vi.fn();
const getMock = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    post: (...args: unknown[]) => postMock(...args) as Promise<unknown>,
    get: (...args: unknown[]) => getMock(...args) as Promise<unknown>,
  },
}));

import { useFichaPreliminar } from "@/hooks/inbox/useFichaPreliminar";
import { readFileSync } from "node:fs";

describe("useFichaPreliminar", () => {
  beforeEach(() => {
    postMock.mockReset();
    getMock.mockReset();
    getMock.mockResolvedValue({ data: { atual: null, historico: [], geracao: null } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("o hook não importa a fila do servidor", () => {
    const src = readFileSync("hooks/inbox/useFichaPreliminar.ts", "utf8");
    expect(src).not.toMatch(/relatorio-preliminar-fila|@upstash\/redis|createAdminClient/);
  });

  it("enfileira e atualiza sozinho quando o GET traz a ficha", async () => {
    postMock.mockResolvedValue({
      data: { status: "gerando", evento_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", existente: false },
    });
    getMock.mockImplementation(async () => {
      if (postMock.mock.calls.length === 0) {
        return { data: { atual: null, historico: [], geracao: null } };
      }
      return {
        data: {
          atual: { versao: 1, ficha: { versao: "preliminar-v1" }, relatorio: "ok fictício" },
          historico: [],
          geracao: null,
        },
      };
    });
    const { result } = renderHook(() => useFichaPreliminar("conversa-ficticia"));
    await waitFor(() => expect(result.current.carregando).toBeNull());

    await act(async () => {
      await result.current.gerar([]);
    });
    expect(postMock).toHaveBeenCalledWith(
      "/api/v1/conversations/conversa-ficticia/painel-agente/ficha",
      { etapa: "gerar" },
    );
    expect(postMock.mock.calls[0]?.[2]).toBeUndefined();
    await waitFor(() => expect(result.current.relatorio).toBe("ok fictício"));
    expect(result.current.gerando).toBe(false);
    expect(result.current.erro).toBeNull();
  });

  it("só consulta o andamento depois que o POST confirma a fila", async () => {
    let aceitar!: (v: unknown) => void;
    postMock.mockImplementation(() => new Promise((resolve) => { aceitar = resolve; }));
    const { result } = renderHook(() => useFichaPreliminar("conversa-ficticia"));
    await waitFor(() => expect(result.current.carregando).toBeNull());
    vi.useFakeTimers();
    let pedido!: Promise<void>;
    act(() => { pedido = result.current.gerar([]); });
    await act(async () => { await Promise.resolve(); });
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(result.current.carregando).toBe("gerar");

    getMock.mockResolvedValue({ data: {
      atual: null, historico: [],
      geracao: { status: "gerando", evento_id: "e1", motivo: null, mensagem: null },
    } });
    await act(async () => {
      aceitar({ data: { status: "gerando", evento_id: "e1" } });
      await pedido;
    });
    expect(result.current.gerando).toBe(true);
    getMock.mockResolvedValue({ data: {
      atual: { versao: 1, ficha: { versao: "preliminar-v1" }, relatorio: "relatório pronto" },
      historico: [], geracao: null,
    } });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(result.current.relatorio).toBe("relatório pronto");
    expect(result.current.gerando).toBe(false);
  });

  it("a resposta do agente inicia o acompanhamento na ficha já montada", async () => {
    const { result, rerender } = renderHook(
      ({ revisao }) => useFichaPreliminar("conversa-ficticia", revisao),
      { initialProps: { revisao: 0 } },
    );
    await waitFor(() => expect(result.current.carregando).toBeNull());
    getMock.mockResolvedValue({ data: {
      atual: null, historico: [],
      geracao: { status: "gerando", evento_id: "e-agente", motivo: null, mensagem: null },
    } });
    rerender({ revisao: 1 });
    await waitFor(() => expect(result.current.gerando).toBe(true));
    expect(postMock).not.toHaveBeenCalled();
    getMock.mockResolvedValue({ data: {
      atual: { versao: 1, ficha: { versao: "preliminar-v1" }, relatorio: "relatório pelo agente" },
      historico: [], geracao: null,
    } });
    await waitFor(() => expect(result.current.relatorio).toBe("relatório pelo agente"), { timeout: 3500 });
  });

  it("resposta sem geração nova preserva a edição local", async () => {
    getMock.mockResolvedValue({ data: {
      atual: { versao: 1, ficha: { versao: "preliminar-v1" }, relatorio: "salvo" },
      historico: [], geracao: null,
    } });
    const { result, rerender } = renderHook(
      ({ revisao }) => useFichaPreliminar("conversa-ficticia", revisao),
      { initialProps: { revisao: 0 } },
    );
    await waitFor(() => expect(result.current.carregando).toBeNull());
    act(() => { result.current.setRelatorio("edição ainda não salva"); });
    rerender({ revisao: 1 });
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    expect(result.current.relatorio).toBe("edição ainda não salva");
  });

  it("segundo clique enquanto gera não enfileira de novo", async () => {
    postMock.mockResolvedValue({
      data: { status: "gerando", evento_id: "e1", existente: false },
    });
    getMock.mockResolvedValue({
      data: {
        atual: null,
        historico: [],
        geracao: { status: "gerando", motivo: null, mensagem: null, evento_id: "e1" },
      },
    });
    const { result } = renderHook(() => useFichaPreliminar("conversa-ficticia"));
    await waitFor(() => expect(result.current.gerando).toBe(true));
    await act(async () => {
      await result.current.gerar([]);
    });
    expect(postMock).not.toHaveBeenCalled();
  });

  it("mostra o erro com motivo legível sem dado pessoal", async () => {
    getMock.mockResolvedValue({
      data: {
        atual: null,
        historico: [],
        geracao: {
          status: "erro",
          motivo: "relatorio_json",
          mensagem: "Não foi possível gerar o relatório preliminar. A resposta da IA veio em formato inválido. Tente de novo.",
          evento_id: "e1",
        },
      },
    });
    const { result } = renderHook(() => useFichaPreliminar("conversa-ficticia"));
    await waitFor(() => expect(result.current.erro).toMatch(/formato inválido/));
    expect(result.current.gerando).toBe(false);
    expect(JSON.stringify(result.current)).not.toMatch(/Maria|119|cpf/i);
  });
});
