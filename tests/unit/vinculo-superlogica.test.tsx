import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.hoisted(() => vi.fn());
const get = vi.hoisted(() => vi.fn());
const del = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({
  apiClient: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a), delete: (...a: unknown[]) => del(...a) },
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { VinculoSuperlogica } from "@/components/locacao/VinculoSuperlogica";

describe("VinculoSuperlogica", () => {
  it("não puxa o cliente MCP do Hub para o bundle do inbox", () => {
    const arquivos = [
      "components/locacao/VinculoSuperlogica.tsx",
      "components/inbox/AnaliseInquilinoDialog.tsx",
      "components/locacao/ResumoLocacaoPainel.tsx",
    ];
    for (const rel of arquivos) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src, rel).not.toMatch(/busca-superlogica|servidor-externo/);
    }
  });

  beforeEach(() => {
    post.mockReset();
    get.mockReset();
    del.mockReset();
    get.mockResolvedValue({ data: { vinculo: null } });
  });

  it("mostra candidatos mascarados e só liga no clique", async () => {
    post.mockResolvedValueOnce({
      data: {
        status: "ok",
        encontrado: true,
        ha_mais: false,
        candidatos: [
          { id: "1001", nome: "Ma*** So***", tipo: "locatário", imovel: "Rua 1", contrato: "9" },
        ],
      },
    }).mockResolvedValueOnce({ data: { id: "v1" } });
    render(
      <VinculoSuperlogica
        conversationId="conv-1"
        contato={{ id: "c1", superlogica_id_pessoa: null, superlogica_tipo: null }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Nome ou CPF"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar na Superlógica" }));
    await screen.findByText(/Ma\*\*\* So\*\*\*/);
    expect(screen.getByLabelText("Nome ou CPF")).toHaveValue("");
    expect(post).toHaveBeenCalledWith("/api/v1/locacao/vinculos/busca", {
      conversation_id: "conv-1",
      pesquisa: "52998224725",
    });
    expect(post).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Ligar este cadastro" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenLastCalledWith("/api/v1/locacao/vinculos", {
      contact_id: "c1",
      superlogica_pessoa_id: "1001",
      tipos: ["locatario"],
    });
    expect(await screen.findByRole("button", { name: "Desfazer vínculo" })).toBeVisible();
  });

  it("some o Desfazer depois de desligar", async () => {
    get.mockResolvedValue({ data: { vinculo: { id: "vinculo-1" } } });
    del.mockResolvedValue({ data: {} });
    render(
      <VinculoSuperlogica
        conversationId="conv-1"
        contato={{ id: "c1", superlogica_id_pessoa: "1001", superlogica_tipo: "locatario" }}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Desfazer vínculo" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("/api/v1/locacao/vinculos", {
      vinculo_id: "vinculo-1",
      motivo: "errado",
    }));
    expect(screen.queryByRole("button", { name: "Desfazer vínculo" })).toBeNull();
  });

  it("sem match avisa e não afirma que a pessoa não existe", async () => {
    post.mockResolvedValue({
      data: { status: "nao_encontrado", encontrado: false, candidatos: [], ha_mais: false },
    });
    render(
      <VinculoSuperlogica
        conversationId="conv-1"
        contato={{ id: "c1", superlogica_id_pessoa: null, superlogica_tipo: null }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Nome ou CPF"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar na Superlógica" }));
    await screen.findByText(/não prova que a pessoa não existe/i);
  });
});
