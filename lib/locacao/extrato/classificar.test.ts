import { describe, expect, it } from "vitest";

import { classificarLancamento, classificarLancamentos } from "./classificar";
import { lerLancamentos } from "./lancamentos";
import { EXTRATO_STONE_SINTETICO } from "./texto-sintetico";
import type { FamiliarDaFicha } from "./familiar";
import type { Lancamento, TitularDoExtrato } from "./tipos";

const titular: TitularDoExtrato = {
  nome: "TITULAR TESTE ALFA",
  cpfDigits: "52998224725",
};

function l(parcial: Partial<Lancamento> & { descricao: string; direcao: "C" | "D" }): Lancamento {
  return {
    data: "05/08/2026",
    valorCentavos: 100_000,
    saldoCentavos: null,
    pagina: 1,
    contraparte: null,
    ...parcial,
  };
}

describe("classificar lançamentos", () => {
  it("separa próprias, resgate, estorno, empréstimo, cartão, salário e terceiros", () => {
    expect(
      classificarLancamento(
        l({ descricao: "TED ENVIADA TITULAR TESTE ALFA", direcao: "D" }),
        titular,
      ),
    ).toBe("propria");
    expect(
      classificarLancamento(l({ descricao: "PIX CPF 529.982.247-25", direcao: "C" }), titular),
    ).toBe("propria");
    expect(
      classificarLancamento(l({ descricao: "RESGATE RENDA FIXA", direcao: "C" }), titular),
    ).toBe("resgate_aplicacao");
    expect(classificarLancamento(l({ descricao: "ESTORNO PIX", direcao: "C" }), titular)).toBe(
      "estorno_devolucao",
    );
    expect(
      classificarLancamento(l({ descricao: "EMPRESTIMO CONSIGNADO", direcao: "C" }), titular),
    ).toBe("emprestimo");
    expect(
      classificarLancamento(l({ descricao: "ANTECIPACAO STONE", direcao: "C" }), titular),
    ).toBe("venda_cartao");
    expect(
      classificarLancamento(l({ descricao: "SALARIO ACME LTDA", direcao: "C" }), titular),
    ).toBe("salario_prolabore");
    expect(
      classificarLancamento(
        l({ descricao: "PIX RECEBIDO EMPRESA FOLHA LTDA", direcao: "C" }),
        titular,
      ),
    ).toBe("terceiro_pj");
    expect(
      classificarLancamento(
        l({ descricao: "PIX RECEBIDO PAGADOR PF BETA", direcao: "C" }),
        titular,
      ),
    ).toBe("terceiro_pf");
    expect(classificarLancamento(l({ descricao: "PAGAMENTO FATURA", direcao: "D" }), titular)).toBe(
      "saida",
    );
    expect(
      classificarLancamento(l({ descricao: "REMUNERACAO ACME LTDA", direcao: "C" }), titular),
    ).toBe("salario_prolabore");
  });

  it("pai e cônjuge da ficha saem; filho por parentesco também", () => {
    const familiares: FamiliarDaFicha[] = [
      { nome: "CONJUGE TESTE BETA", cpfDigits: "11144477735", papel: "conjuge" },
      { nome: "JOAO ALFA PAI", cpfDigits: null, papel: "parente" },
    ];
    expect(
      classificarLancamento(
        l({ descricao: "PIX RECEBIDO CONJUGE TESTE BETA", direcao: "C" }),
        titular,
        familiares,
      ),
    ).toBe("conjuge");
    expect(
      classificarLancamento(
        l({ descricao: "PIX CPF 111.444.777-35", direcao: "C" }),
        titular,
        familiares,
      ),
    ).toBe("conjuge");
    expect(
      classificarLancamento(
        l({ descricao: "PIX RECEBIDO JOAO ALFA PAI", direcao: "C" }),
        titular,
        familiares,
      ),
    ).toBe("familiar");
    expect(
      classificarLancamento(
        l({ descricao: "PIX RECEBIDO FILHO TESTE GAMA", direcao: "C" }),
        titular,
        familiares,
      ),
    ).toBe("familiar");
  });

  it("sobrenome em comum com o titular sai sinalizado como familiar provável", () => {
    expect(
      classificarLancamento(
        l({ descricao: "PIX RECEBIDO MARIA ALFA", direcao: "C", contraparte: "MARIA ALFA" }),
        titular,
      ),
    ).toBe("familiar_provavel");
  });

  it("classifica o extrato Stone sintético sem logar CPF", () => {
    const leitura = lerLancamentos(EXTRATO_STONE_SINTETICO);
    const classes = classificarLancamentos(leitura.lancamentos, leitura.titular).map(
      (x) => x.classe,
    );
    expect(classes).toContain("propria");
    expect(classes).toContain("resgate_aplicacao");
    expect(classes).toContain("estorno_devolucao");
    expect(classes).toContain("emprestimo");
    expect(classes).toContain("venda_cartao");
    expect(classes).toContain("terceiro_pj");
    expect(classes).toContain("terceiro_pf");
    expect(JSON.stringify(classes)).not.toMatch(/52998224725/);
  });

  it("transferência entre contas pela palavra, sem nome", () => {
    expect(
      classificarLancamento(
        l({ descricao: "TRANSFERENCIA ENTRE CONTAS CONTA STONE", direcao: "C" }),
        { nome: null, cpfDigits: null },
      ),
    ).toBe("propria");
  });
});
