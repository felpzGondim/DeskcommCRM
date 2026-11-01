import type { ComponentProps } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

const patch = vi.fn();
const semReload = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiClient: { patch: (...args: unknown[]) => patch(...args) },
}));

import { AcoesDoProcesso } from "./_acoes";

function montar(props?: Partial<ComponentProps<typeof AcoesDoProcesso>>) {
  return render(
    <IdiomaProvider locale="pt-BR">
      <AcoesDoProcesso
        processoId="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        status="analise"
        podeAprovar
        {...props}
      />
    </IdiomaProvider>,
  );
}

describe("AcoesDoProcesso — confirmação humana", () => {
  beforeEach(() => {
    patch.mockReset().mockResolvedValue({ data: { status: "aprovado" } });
    semReload.mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: semReload },
    });
  });

  it("o primeiro clique só abre o diálogo — sem confirmação não aprova", async () => {
    const user = userEvent.setup({ delay: null });
    montar();

    await user.click(screen.getByRole("button", { name: "Aprovar processo" }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(dialogo).toHaveTextContent("Aprovar este processo?");
    expect(patch).not.toHaveBeenCalled();
  });

  it("cancelar fecha o diálogo e não chama a API", async () => {
    const user = userEvent.setup({ delay: null });
    montar();

    await user.click(screen.getByRole("button", { name: "Aprovar processo" }));
    const dialogo = await screen.findByRole("alertdialog");
    await user.click(within(dialogo).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(patch).not.toHaveBeenCalled();
  });

  it("confirmar é o que envia a aprovação", async () => {
    const user = userEvent.setup({ delay: null });
    montar();

    await user.click(screen.getByRole("button", { name: "Aprovar processo" }));
    const dialogo = await screen.findByRole("alertdialog");
    await user.click(within(dialogo).getByRole("button", { name: "Aprovar processo" }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]![1]).toMatchObject({
      acao: "aprovar",
      confirmado: true,
    });
  });

  it("reabrir também pede confirmação", async () => {
    const user = userEvent.setup({ delay: null });
    montar({ status: "reprovado" });

    await user.click(screen.getByRole("button", { name: "Reabrir processo" }));
    expect(patch).not.toHaveBeenCalled();

    const dialogo = await screen.findByRole("alertdialog");
    expect(dialogo).toHaveTextContent("Reabrir este processo?");
    await user.click(within(dialogo).getByRole("button", { name: "Reabrir processo" }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]![1]).toMatchObject({
      acao: "reabrir",
      confirmado: true,
    });
  });
});
