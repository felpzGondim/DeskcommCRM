/**
 * O diálogo de importação: a opção começa desligada; ligada, o primeiro
 * envio é prévia e um único "Confirmar importação" grava.
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
    filled: 0,
    replaced: 0,
    updated: 0,
    skipped_duplicates: 0,
    preview: false,
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
      confirmar: undefined,
    });
  });

  it("com a opção ligada, a prévia conta e um único confirmar grava", async () => {
    mutateAsync
      .mockResolvedValueOnce(
        resumo({
          total_linhas: 3,
          imported: 1,
          filled: 1,
          replaced: 1,
          updated: 2,
          preview: true,
        }),
      )
      .mockResolvedValueOnce(
        resumo({
          total_linhas: 3,
          imported: 1,
          filled: 1,
          replaced: 1,
          updated: 2,
          preview: false,
        }),
      );
    const user = userEvent.setup({ delay: null });
    montar();
    await user.click(screen.getByTestId("atualizar-existentes"));
    await user.upload(screen.getByTestId("arquivo-de-contatos"), csv());
    await user.click(screen.getByRole("button", { name: "Importar" }));

    const painel = await screen.findByTestId("resumo-da-importacao");
    expect(painel).toHaveTextContent("1 serão criado(s)");
    expect(painel).toHaveTextContent("1 serão preenchido(s)");
    expect(painel).toHaveTextContent("1 serão substituído(s)");
    expect(screen.queryByRole("button", { name: "Concluir" })).toBeNull();

    await user.click(screen.getByTestId("confirmar-importacao"));
    expect(mutateAsync).toHaveBeenLastCalledWith({
      file: expect.any(File),
      atualizarExistentes: true,
      confirmar: true,
    });
    expect(await screen.findByTestId("resumo-da-importacao")).toHaveTextContent("1 importado(s)");
    expect(screen.getByRole("button", { name: "Concluir" })).toBeTruthy();
  });
});
