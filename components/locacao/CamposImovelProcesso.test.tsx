import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CamposImovelProcesso } from "@/components/locacao/CamposImovelProcesso";
import { valoresVazios } from "@/lib/locacao/valores-imovel";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

describe("CamposImovelProcesso", () => {
  it("mostra origem de cada valor e que fiança não entra no 3×", () => {
    const valores = valoresVazios();
    valores.aluguel = { valor: 2000, origem: "superlogica", editado_por: null, editado_em: null };
    valores.condominio = { valor: 500, origem: "conversa", editado_por: null, editado_em: null };
    render(<CamposImovelProcesso valores={valores} onSalvar={vi.fn()} />);
    expect(screen.getByTestId("campos-imovel-processo")).toBeTruthy();
    expect(screen.getByDisplayValue("2000")).toBeTruthy();
    expect(screen.getByText(/Superlógica/)).toBeTruthy();
    expect(screen.getByText(/conversa\/ficha/)).toBeTruthy();
    expect(screen.getByText(/não entra no 3×/)).toBeTruthy();
    expect(screen.getByLabelText(/Seguro-fiança/)).toBeTruthy();
  });

  it("grava só o que o atendente mudou", async () => {
    const onSalvar = vi.fn().mockResolvedValue(undefined);
    const valores = valoresVazios();
    valores.aluguel = { valor: 2000, origem: "conversa", editado_por: null, editado_em: null };
    render(<CamposImovelProcesso valores={valores} onSalvar={onSalvar} />);
    fireEvent.change(screen.getByLabelText(/Condomínio/), { target: { value: "450" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar valores do imóvel" }));
    expect(onSalvar).toHaveBeenCalledWith({ condominio: 450 });
  });
});
