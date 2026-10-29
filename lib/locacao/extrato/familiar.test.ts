import { describe, expect, it } from "vitest";

import { decidirFamiliar, forcaDoNome, sobrenomeDe } from "./familiar";
import type { Lancamento, TitularDoExtrato } from "./tipos";

const titular: TitularDoExtrato = {
  nome: "MARIA ALFA TESTE",
  cpfDigits: "52998224725",
};

function l(parcial: Partial<Lancamento> & { descricao: string }): Lancamento {
  return {
    data: "05/08/2026",
    valorCentavos: 100_000,
    direcao: "C",
    saldoCentavos: null,
    pagina: 1,
    contraparte: null,
    ...parcial,
  };
}

describe("match de familiar", () => {
  it("nome ou CPF da ficha é familiar confirmado", () => {
    expect(
      decidirFamiliar(l({ descricao: "PIX RECEBIDO JOAO DA SILVA PAI" }), titular, [
        { nome: "JOAO DA SILVA PAI", cpfDigits: null, papel: "parente" },
      ])?.classe,
    ).toBe("familiar");
    expect(
      decidirFamiliar(l({ descricao: "PIX CPF 111.444.777-35" }), titular, [
        { nome: "ANA BETA", cpfDigits: "11144477735", papel: "conjuge" },
      ]),
    ).toEqual({ classe: "conjuge", motivo: "cpf_ficha" });
  });

  it("palavra de parentesco confirma (filho, pai), não terceiro", () => {
    expect(
      decidirFamiliar(l({ descricao: "PIX RECEBIDO FILHO TESTE GAMA" }), titular, [])?.classe,
    ).toBe("familiar");
    expect(decidirFamiliar(l({ descricao: "PIX RECEBIDO PAI JOSE" }), titular, [])?.motivo).toBe(
      "parentesco",
    );
  });

  it("só sobrenome em comum sai sinalizado como provável", () => {
    const d = decidirFamiliar(
      l({ descricao: "PIX RECEBIDO CARLOS TESTE", contraparte: "CARLOS TESTE" }),
      titular,
      [],
    );
    expect(d).toEqual({ classe: "familiar_provavel", motivo: "sobrenome" });
  });

  it("sobrenome frequente (SILVA) é provável, nunca descarte silencioso", () => {
    const d = decidirFamiliar(
      l({ descricao: "PIX RECEBIDO PEDRO SILVA" }),
      { nome: "MARIA SILVA", cpfDigits: null },
      [],
    );
    expect(d).toEqual({ classe: "familiar_provavel", motivo: "sobrenome_comum" });
  });

  it("nome parcial da ficha é provável", () => {
    const d = decidirFamiliar(l({ descricao: "PIX RECEBIDO JOAO" }), titular, [
      { nome: "JOAO DA SILVA SANTOS", cpfDigits: null, papel: "parente" },
    ]);
    expect(d).toEqual({ classe: "familiar_provavel", motivo: "nome_parcial" });
  });

  it("PJ com o mesmo sobrenome não é familiar", () => {
    expect(
      decidirFamiliar(l({ descricao: "PIX RECEBIDO ALFA TESTE LTDA" }), titular, []),
    ).toBeNull();
  });

  it("terceiro sem relação não é familiar", () => {
    expect(
      decidirFamiliar(l({ descricao: "PIX RECEBIDO PAGADOR PF BETA" }), titular, []),
    ).toBeNull();
  });

  it("força do nome e sobrenome ignoram partículas", () => {
    expect(forcaDoNome("JOAO DA SILVA", "JOAO SILVA")).toBe("primeiro_ultimo");
    expect(sobrenomeDe("MARIA DE SOUZA")).toBe("SOUZA");
  });
});
