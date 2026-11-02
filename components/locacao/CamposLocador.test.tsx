import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CamposLocador } from "@/components/locacao/CamposLocador";
import { CAMPO_VAZIO } from "@/lib/locacao/ficha-schema";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

const vazio = {
  nome: { ...CAMPO_VAZIO },
  documento: { ...CAMPO_VAZIO },
  contato: { ...CAMPO_VAZIO },
};

describe("CamposLocador", () => {
  it("sem vínculo mostra campos vazios com origem vazio", () => {
    render(<CamposLocador locador={vazio} onAlterar={vi.fn()} />);
    expect(screen.getByLabelText("Nome do locador")).toHaveValue("");
    expect(screen.getByLabelText("CPF/CNPJ do locador")).toHaveValue("");
    expect(screen.getByLabelText("Contato do locador")).toHaveValue("");
    const selos = screen.getAllByTestId("selo-origem");
    expect(selos).toHaveLength(3);
    expect(selos.every((el) => el.getAttribute("data-origem") === "vazio")).toBe(true);
  });

  it("vínculo de proprietário preenche mascarado com origem Superlógica", () => {
    render(
      <CamposLocador
        locador={vazio}
        vinculo={{
          nome: "Bruno Lima",
          documento_mascarado: "***.***.**7-25",
          contato_mascarado: "(11) *****-4321",
        }}
        onAlterar={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Nome do locador")).toHaveValue("Bruno Lima");
    expect(screen.getByLabelText("CPF/CNPJ do locador")).toHaveValue("***.***.**7-25");
    expect(screen.getByLabelText("Contato do locador")).toHaveValue("(11) *****-4321");
    expect(screen.getAllByTestId("selo-origem").every((el) => el.getAttribute("data-origem") === "superlogica")).toBe(true);
  });
});
