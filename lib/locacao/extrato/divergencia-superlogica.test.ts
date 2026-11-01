import { describe, expect, it } from "vitest";

import {
  avisoDoCampoNasPendencias,
  divergenciaDeCentavos,
  divergenciaDeCep,
  divergenciaDeEndereco,
  textoEnderecoParaConfronto,
} from "./divergencia-superlogica";

describe("confronto Superlógica × ficha", () => {
  it("não avisa quando só um lado tem valor, e formata ficha × Superlógica", () => {
    expect(divergenciaDeCentavos("aluguel", 200_000, null)).toBeNull();
    expect(divergenciaDeCentavos("aluguel", null, 300_000)).toBeNull();
    expect(divergenciaDeCentavos("aluguel", 200_000, 200_000)).toBeNull();
    const d = divergenciaDeCentavos("aluguel", 200_000, 300_000);
    expect(d?.campo).toBe("aluguel");
    expect(d?.aviso).toMatch(/^Aluguel diverge: ficha /);
    expect(d?.aviso).toMatch(/Superlógica/);
  });

  it("compara endereço e CEP normalizados; vazio não diverge", () => {
    expect(divergenciaDeEndereco("Rua A, 10", "rua a 10")).toBeNull();
    expect(divergenciaDeEndereco("Rua A, 10", null)).toBeNull();
    expect(divergenciaDeEndereco("Rua A, 10", "Rua B, 20")?.campo).toBe("endereco");
    expect(divergenciaDeCep("01310-100", "01310100")).toBeNull();
    expect(divergenciaDeCep("01310-100", "01310200")?.aviso).toMatch(/01310-100/);
    expect(textoEnderecoParaConfronto({ logradouro: "Rua A", numero: "10" })).toBe("Rua A, 10");
    expect(avisoDoCampoNasPendencias(
      ["Aluguel diverge: ficha R$ 1,00 × Superlógica R$ 2,00."],
      "aluguel",
    )).toMatch(/Aluguel diverge/);
  });
});
