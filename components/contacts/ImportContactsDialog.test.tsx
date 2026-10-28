/**
 * O diálogo de importação: a opção começa desligada, o conflito pede
 * confirmação e o resumo mostra criado / atualizado / pulado / conflito.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ImportContactsResult } from "@/hooks/contacts/useImportContacts";

const mutateAsync = vi.fn();
vi.mock("@/hooks/contacts/useImportContacts", () => ({
  useImportContacts: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("@/hooks/i18n/useT", () => ({
  useT: () => (texto: string) => texto,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

import { ImportContactsDialog } from "./ImportContactsDialog";

function resumo(parcial: Partial<ImportContactsResult> = {}): ImportContactsResult {
  return {
    total_linhas: 0,
    imported: 0,
    updated: 0,
    skipped_duplicates: 0,
    conflicts: [],
    errors: [],
    ...parcial,
  };
}

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ImportContactsDialog open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

function csv(): File {
  return new File(["nome,telefone\nMaria,+5511999998888\n"], "contatos.csv", { type: "text/csv" });
}

describe("ImportContactsDialog", () => {
  beforeEach(() => mutateAsync.mockReset());

  it("a opção de atualizar começa desligada e o primeiro envio não a manda", async () => {
    mutateAsync.mockResolvedValue(resumo({ total_linhas: 1, imported: 1 }));
    const user = userEvent.setup({ delay: null });
    montar();
    const caixa = screen.getByTestId("atualizar-existentes") as HTMLInputElement;
    expect(caixa.checked).toBe(false);
    await user.upload(screen.getByTestId("arquivo-de-contatos"), csv());
    await user.click(screen.getByRole("button", { name: "Importar" }));
    expect(mutateAsync).toHaveBeenCalledWith({
      file: expect.any(File),
      atualizarExistentes: false,
      substituirContactIds: undefined,
    });
  });

  it("com a opção ligada, conflito lista os nomes e só substitui no segundo clique", async () => {
    mutateAsync
      .mockResolvedValueOnce(
        resumo({
          total_linhas: 1,
          skipped_duplicates: 0,
          conflicts: [
            {
              linha: 2,
              contact_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              nome_atual: "Carlos",
              nome_planilha: "Carlos Silva",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(resumo({ updated: 1 }));
    const user = userEvent.setup({ delay: null });
    montar();
    await user.click(screen.getByTestId("atualizar-existentes"));
    await user.upload(screen.getByTestId("arquivo-de-contatos"), csv());
    await user.click(screen.getByRole("button", { name: "Importar" }));

    expect(await screen.findByTestId("conflitos-de-nome")).toHaveTextContent("Carlos Silva");
    expect(screen.getByTestId("resumo-da-importacao")).toHaveTextContent("1 conflito(s)");
    expect(screen.queryByRole("button", { name: "Concluir" })).toBeNull();

    await user.click(screen.getByTestId("substituir-nomes"));
    expect(mutateAsync).toHaveBeenLastCalledWith({
      file: expect.any(File),
      atualizarExistentes: true,
      substituirContactIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    });
    expect(await screen.findByTestId("resumo-da-importacao")).toHaveTextContent("1 atualizado(s)");
    expect(screen.queryByTestId("conflitos-de-nome")).toBeNull();
  });
});
