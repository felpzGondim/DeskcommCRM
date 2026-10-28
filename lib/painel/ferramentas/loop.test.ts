import { describe, expect, it } from "vitest";

import { FRASE_CONTINUAR, modoDaPergunta, tetosDoModo } from "./loop";
import {
  TETO_CUSTO_ANALISE_USD,
  TETO_CUSTO_NORMAL_USD,
  TETO_PASSOS_ANALISE,
  TETO_PASSOS_NORMAL,
  TETO_TEMPO_ANALISE_MS,
  TETO_TEMPO_NORMAL_MS,
} from "./tipos";

describe("limites do campo /pergunta", () => {
  it("modo normal: 6 passos, US$ 0,05, 45 s; análise: 10, US$ 0,30, 120 s", () => {
    expect(tetosDoModo("normal")).toEqual({
      passos: TETO_PASSOS_NORMAL,
      custoUsd: TETO_CUSTO_NORMAL_USD,
      tempoMs: TETO_TEMPO_NORMAL_MS,
    });
    expect(tetosDoModo("analise")).toEqual({
      passos: TETO_PASSOS_ANALISE,
      custoUsd: TETO_CUSTO_ANALISE_USD,
      tempoMs: TETO_TEMPO_ANALISE_MS,
    });
    expect(TETO_PASSOS_NORMAL).toBe(6);
    expect(TETO_PASSOS_ANALISE).toBe(10);
    expect(TETO_CUSTO_NORMAL_USD).toBe(0.05);
    expect(TETO_CUSTO_ANALISE_USD).toBe(0.3);
    expect(TETO_TEMPO_NORMAL_MS).toBe(45_000);
    expect(TETO_TEMPO_ANALISE_MS).toBe(120_000);
  });

  it("pede análise quando a pergunta fala de anexo, FC ou relatório", () => {
    expect(modoDaPergunta("qual o aluguel?", [])).toBe("normal");
    expect(modoDaPergunta("pode ler o holerite em anexo?", [])).toBe("analise");
    expect(modoDaPergunta("quero o relatório preliminar", [])).toBe("analise");
  });

  it("no limite oferece continuar", () => {
    expect(FRASE_CONTINUAR).toMatch(/Continuar/);
  });
});
