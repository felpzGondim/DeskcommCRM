import { describe, expect, it } from "vitest";

import {
  ROTULO_DO_SELO_DE_ORIGEM,
  rotuloDaOrigemDoCampo,
  seloDaFonte,
  seloDaOrigemDoValor,
} from "@/lib/locacao/origem-do-campo";

describe("selo de origem da aba Dados", () => {
  it("mapeia fonte da ficha para o selo visível", () => {
    expect(seloDaFonte("atendente", true)).toBe("manual");
    expect(seloDaFonte("manual", true)).toBe("manual");
    expect(seloDaFonte("superlogica", true)).toBe("superlogica");
    expect(seloDaFonte("conversa", true)).toBe("conversa");
    expect(seloDaFonte("preliminar_ia", true)).toBe("conversa");
    expect(seloDaFonte("padrao", true)).toBe("padrao");
    expect(seloDaFonte(null, true)).toBe("conversa");
  });

  it("sem valor é vazio, mesmo com fonte", () => {
    expect(seloDaFonte("atendente", false)).toBe("vazio");
    expect(seloDaFonte("conversa", false)).toBe("vazio");
    expect(seloDaOrigemDoValor(null)).toBe("vazio");
  });

  it("os rótulos da tela são os cinco selos, inclusive padrão", () => {
    expect(Object.values(ROTULO_DO_SELO_DE_ORIGEM)).toEqual([
      "manual",
      "Superlógica",
      "conversa",
      "padrão",
      "vazio",
    ]);
    expect(rotuloDaOrigemDoCampo("atendente", true)).toBe("manual");
    expect(rotuloDaOrigemDoCampo(null, false)).toBe("vazio");
  });
});
