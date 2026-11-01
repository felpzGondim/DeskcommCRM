import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AbaComExecucao } from "@/components/locacao/AbaComExecucao";
import type { ExecucaoPublica } from "@/lib/locacao/execucao-da-aba";

function exec(parcial: Partial<ExecucaoPublica> & Pick<ExecucaoPublica, "estado">): ExecucaoPublica {
  return {
    id: "e1",
    aba: "renda",
    etapa_texto: null,
    progresso_atual: 0,
    progresso_total: 0,
    erro_motivo: null,
    entrada_hash: "aaa",
    ficha_versao: 1,
    origem: "botao",
    iniciado_em: "2026-11-01T12:00:00.000Z",
    terminado_em: "2026-11-01T12:05:00.000Z",
    created_at: "2026-11-01T12:00:00.000Z",
    updated_at: "2026-11-01T12:00:00.000Z",
    ...parcial,
  };
}

describe("AbaComExecucao — estados da casca", () => {
  it("mostra na fila", () => {
    render(<AbaComExecucao execucao={exec({ estado: "na_fila" })} />);
    expect(screen.getByTestId("aba-com-execucao")).toHaveAttribute("data-estado", "na_fila");
    expect(screen.getByRole("status")).toHaveTextContent("Na fila");
  });

  it("mostra processando com a etapa atual", () => {
    render(
      <AbaComExecucao
        execucao={exec({
          estado: "processando",
          etapa_texto: "lendo extrato pág. 12 de 43",
          progresso_atual: 12,
          progresso_total: 43,
        })}
      />,
    );
    expect(screen.getByTestId("aba-com-execucao")).toHaveAttribute("data-estado", "processando");
    expect(screen.getByRole("status")).toHaveTextContent("lendo extrato pág. 12 de 43");
    expect(screen.getByText("12 / 43")).toBeVisible();
  });

  it("mostra concluído e a hora da última execução", () => {
    render(<AbaComExecucao execucao={exec({ estado: "concluido" })} />);
    expect(screen.getByTestId("aba-com-execucao")).toHaveAttribute("data-estado", "concluido");
    expect(screen.getByRole("status")).toHaveTextContent("Concluído");
    expect(screen.getByTestId("hora-da-execucao")).toHaveTextContent("Última execução");
  });

  it("mostra erro com motivo simples e Tentar de novo chama onRodar", () => {
    const onRodar = vi.fn();
    render(
      <AbaComExecucao
        execucao={exec({ estado: "erro", erro_motivo: "PDF com senha" })}
        rotuloBotao="Analisar renda"
        onRodar={onRodar}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("PDF com senha");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(onRodar).toHaveBeenCalledTimes(1);
  });

  it("mostra desatualizado quando o hash da entrada mudou", () => {
    render(
      <AbaComExecucao
        execucao={exec({ estado: "concluido", entrada_hash: "aaa" })}
        hashAtual="bbb"
        rotuloBotao="Analisar renda"
        onRodar={vi.fn()}
      />,
    );
    expect(screen.getByTestId("aba-com-execucao")).toHaveAttribute("data-estado", "desatualizado");
    expect(screen.getByRole("status")).toHaveTextContent("desatualizado — rode de novo");
  });

  it("lista o que falta e desliga o botão", () => {
    render(
      <AbaComExecucao
        execucao={null}
        checklist={["Salve a ficha para abrir o processo."]}
        rotuloBotao="Analisar renda"
        onRodar={vi.fn()}
      />,
    );
    expect(screen.getByText("Que falta para rodar")).toBeVisible();
    expect(screen.getByText("Salve a ficha para abrir o processo.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Analisar renda" })).toBeDisabled();
  });
});
