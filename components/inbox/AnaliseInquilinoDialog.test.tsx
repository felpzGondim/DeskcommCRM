import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
  },
}));

import { AnaliseInquilinoDialog } from "@/components/inbox/AnaliseInquilinoDialog";
import { ABAS_DO_MODAL_LOCACAO, ROTULO_DA_ABA } from "@/lib/locacao/execucao-da-aba";

const locacaoOk = {
  data: {
    habilitado: true,
    analise: { renda: true, fc: true, seguro: true, relatorio: true },
    contato: { id: "c1", superlogica_id_pessoa: null, superlogica_tipo: null },
    processos: [{ id: "proc-1", status: "analise", renda_confirmada_em: "2026-11-01T12:00:00.000Z" }],
    execucoes: {},
    entrada_atual: "aaa",
    etapa_quadro: { status: "analise", processo_id: "proc-1" },
  },
};

describe("casca do modal de locação", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/locacao/documentos")) {
        return { data: { recebidos: [], documentos: [], participantes: [], pendencias: [], relatorios: [], ha_mais: false } };
      }
      if (u.includes("/ficha")) return { data: { atual: null, historico: [] } };
      if (u.endsWith("/locacao")) return locacaoOk;
      return { data: {} };
    });
    post.mockResolvedValue({ data: {} });
  });

  it("as abas vêm na ordem Dados, Renda, FC, Migra, Relatório, Contrato, Documentos — sem Analisar tudo", async () => {
    render(
      <AnaliseInquilinoDialog
        aberto
        onAbertoChange={vi.fn()}
        conversationId="conv-1"
        senhasPdf={[]}
      />,
    );
    await waitFor(() => expect(get).toHaveBeenCalled());
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((el) => el.textContent)).toEqual(ABAS_DO_MODAL_LOCACAO.map((id) => ROTULO_DA_ABA[id]));
    expect(screen.queryByRole("tab", { name: "Superlógica" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Analisar tudo" })).toBeNull();
    expect(screen.getByTestId("etapa-do-quadro")).toHaveTextContent("O modal não move o card do quadro.");
    expect(screen.getByTestId("etapa-do-quadro")).toHaveTextContent("Análise");
  });

  it("Documentos fica por último e o Superlógica mora em Dados", async () => {
    render(
      <AnaliseInquilinoDialog
        aberto
        onAbertoChange={vi.fn()}
        conversationId="conv-1"
        senhasPdf={[]}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("Nome ou CPF")).toBeVisible());
    const tabs = screen.getAllByRole("tab");
    expect(tabs.at(-1)).toHaveTextContent("Documentos");
    fireEvent.click(screen.getByRole("tab", { name: "Documentos" }));
    expect(await screen.findByTestId("documentos-locacao")).toBeVisible();
  });

  it("não puxa o cliente MCP do Hub para o bundle do inbox", () => {
    const arquivos = [
      "components/inbox/AnaliseInquilinoDialog.tsx",
      "components/locacao/AbaComExecucao.tsx",
      "lib/locacao/acoes-do-modal.ts",
      "lib/locacao/execucao-da-aba.ts",
    ];
    for (const rel of arquivos) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src, rel).not.toMatch(/busca-superlogica|servidor-externo|@modelcontextprotocol/);
    }
  });
});
