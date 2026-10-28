import { describe, expect, it } from "vitest";

import {
  chaveEndereco,
  codigoFc,
  enderecosIguais,
  normalizarComplemento,
  normalizarLogradouro,
  normalizarNumero,
} from "@/lib/locacao/endereco";

describe("normalização de endereço", () => {
  it("padroniza tipo de logradouro, acento e caixa", () => {
    expect(normalizarLogradouro("R. Exemplo")).toBe("rua exemplo");
    expect(normalizarLogradouro("Av. das Nações")).toBe("avenida das nacoes");
    expect(normalizarLogradouro("Al. Santos")).toBe("alameda santos");
    expect(normalizarLogradouro("Trav. da Paz")).toBe("travessa da paz");
  });

  it("número guarda dígitos e sufixo de letra", () => {
    expect(normalizarNumero("100")).toBe("100");
    expect(normalizarNumero("100-B")).toBe("100b");
    expect(normalizarNumero("nº 14")).toBe("14");
  });

  it("complemento: apto/ap./apartamento → ap; bloco → bl; casa → cs", () => {
    expect(normalizarComplemento("apto 14")).toBe("ap 14");
    expect(normalizarComplemento("ap. 14")).toBe("ap 14");
    expect(normalizarComplemento("apartamento 14")).toBe("ap 14");
    expect(normalizarComplemento("Bloco B")).toBe("bl b");
    expect(normalizarComplemento("casa 2")).toBe("cs 2");
  });

  it("chave: rua|numero|complemento|cep", () => {
    expect(chaveEndereco({
      logradouro: "R. Exemplo",
      numero: "100",
      complemento: "apto 1",
      cep: "01310-100",
    })).toBe("rua exemplo|100|ap 1|01310100");
  });

  it("CEP ausente de um lado não diferencia", () => {
    const comCep = chaveEndereco({
      logradouro: "Rua Exemplo", numero: "100", complemento: "ap 1", cep: "01310100",
    });
    const semCep = chaveEndereco({
      logradouro: "Rua Exemplo", numero: "100", complemento: "ap 1",
    });
    expect(enderecosIguais(comCep, semCep)).toBe(true);
    expect(enderecosIguais(comCep, chaveEndereco({
      logradouro: "Rua Exemplo", numero: "100", complemento: "ap 1", cep: "00000000",
    }))).toBe(false);
  });

  it("codigo_fc é primeira palavra + apto, só para a FC", () => {
    expect(codigoFc({
      logradouro: "Rua Exemplo", numero: "100", complemento: "apto 14",
    })).toBe("rua14");
  });
});
