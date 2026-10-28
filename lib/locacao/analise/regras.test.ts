import { describe, expect, it } from "vitest";

import {
  aplicarRegrasDaRenda,
  classeDoLancamento,
  lancamentosDoTexto,
  motivoDeExclusao,
  parseValorBr,
} from "@/lib/locacao/analise/regras";

const EXTRATO = `
05/09 Salário folha ACME R$ 4.500,00
06/09 Transferência entre contas próprias R$ 1.200,00
07/09 Resgate poupança R$ 800,00
08/09 Rende Fácil aplicação R$ 300,00
09/09 PIX recebido de terceiro João R$ 250,00
10/09 Aluguel recebido apto 12 R$ 1.000,00
`;

describe("regras da análise de renda", () => {
  it("lê R$ e ignora a data do extrato", () => {
    expect(parseValorBr("05/09 Salário folha ACME R$ 4.500,00")).toBe(4500);
    expect(parseValorBr("10/09 Aluguel recebido apto 12 R$ 1.000,00")).toBe(1000);
  });

  it("classifica autotransferência, poupança, Rende Fácil e PIX de terceiros", () => {
    expect(motivoDeExclusao("Transferência entre contas próprias")).toBe("autotransferencia");
    expect(motivoDeExclusao("Resgate poupança")).toBe("poupanca");
    expect(motivoDeExclusao("Rende Fácil aplicação automática")).toBe("rende_facil");
    expect(motivoDeExclusao("PIX recebido de terceiro Maria")).toBe("pix_terceiros");
    expect(classeDoLancamento("Salário folha ACME")).toBe("renda_recorrente");
  });

  it("textos de mentira: exclusões saem da comprovada e PIX fica à parte", () => {
    const lancamentos = lancamentosDoTexto(EXTRATO, "M1");
    const r = aplicarRegrasDaRenda(lancamentos);
    expect(r.comprovada).toBe(5500);
    expect(r.proposta_fc).toBe(5500);
    expect(r.autotransferencias).toHaveLength(1);
    expect(r.poupanca).toHaveLength(1);
    expect(r.rende_facil).toHaveLength(1);
    expect(r.pix_terceiros).toHaveLength(1);
    expect(r.pix_terceiros[0]?.valor).toBe(250);
    expect(r.alertas.join(" ")).toMatch(/Autotransferência/i);
    expect(r.alertas.join(" ")).toMatch(/poupança/i);
    expect(r.alertas.join(" ")).toMatch(/Rende Fácil/i);
    expect(r.alertas.join(" ")).toMatch(/PIX de terceiros/i);
  });

  it("a regra vence a classe que o modelo chutou", () => {
    const r = aplicarRegrasDaRenda([
      {
        descricao: "Rende Fácil resgate",
        valor: 900,
        data: null,
        fonte: "M1",
        trecho: "Rende Fácil resgate",
        classe: "renda_recorrente",
      },
    ]);
    expect(r.comprovada).toBe(0);
    expect(r.rende_facil).toHaveLength(1);
  });
});
