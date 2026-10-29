import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  codigoDaFalhaDoRelatorio,
  motivoDaFalhaDoRelatorio,
  textoDaFalhaDoRelatorio,
} from "@/lib/painel/relatorio-preliminar-motivo";

describe("motivo da falha do relatório preliminar", () => {
  it("classifica saida_truncada, extrator_json, relatorio_json e zod", () => {
    expect(motivoDaFalhaDoRelatorio(new Error("saida_truncada"))).toBe("saida_truncada");
    expect(motivoDaFalhaDoRelatorio(new Error("extrator_json"))).toBe("extrator_json");
    expect(motivoDaFalhaDoRelatorio(new SyntaxError("Unexpected token"))).toBe("relatorio_json");
    expect(motivoDaFalhaDoRelatorio(new Error("json_ausente"))).toBe("relatorio_json");
    expect(motivoDaFalhaDoRelatorio(new z.ZodError([]))).toBe("zod");
    expect(motivoDaFalhaDoRelatorio(new Error("outro"))).toBe("invalid_format");
  });

  it("o texto é legível e o código de API só distingue corte", () => {
    expect(codigoDaFalhaDoRelatorio("saida_truncada")).toBe("saida_truncada");
    expect(codigoDaFalhaDoRelatorio("zod")).toBe("invalid_format");
    expect(textoDaFalhaDoRelatorio("saida_truncada")).toMatch(/incompleta/);
    expect(textoDaFalhaDoRelatorio("extrator_json")).toMatch(/extração do extrato/);
    expect(textoDaFalhaDoRelatorio("relatorio_json")).toMatch(/formato inválido/);
  });
});
