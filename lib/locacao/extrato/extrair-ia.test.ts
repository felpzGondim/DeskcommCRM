import { describe, expect, it, vi } from "vitest";

import { analisarExtratoComIa } from "./analisar";
import { precisaExtracaoPorIa, type ExtratorDeLancamentos } from "./extrair-ia";
import { conferirSaldo } from "./saldo";
import type { Lancamento } from "./tipos";

const EXTRATO_LAYOUT_DESCONHECIDO = `
Extrato Banco Inventado
01/08/2026  02/08/2026  03/08/2026  04/08/2026  05/08/2026
lançamento em formato que o parser não lê
`.trim();

function lanc(parcial: Partial<Lancamento> & Pick<Lancamento, "data" | "descricao" | "valorCentavos" | "direcao">): Lancamento {
  return {
    saldoCentavos: null,
    pagina: 1,
    contraparte: parcial.descricao,
    ...parcial,
  };
}

describe("extração por IA de extrato sem layout", () => {
  it("layout desconhecido com cara de extrato pede IA", () => {
    expect(
      precisaExtracaoPorIa({
        layout: "desconhecido",
        lancamentos: 0,
        paginasFaltando: false,
        saldoFecha: true,
        escaneado: false,
        pareceExtrato: true,
      }),
    ).toBe(true);
  });

  it("PDF escaneado sem texto não dispara IA", () => {
    expect(
      precisaExtracaoPorIa({
        layout: "desconhecido",
        lancamentos: 0,
        paginasFaltando: false,
        saldoFecha: true,
        escaneado: true,
        pareceExtrato: true,
      }),
    ).toBe(false);
  });

  it("layout desconhecido cai na IA e marca a fonte", async () => {
    const extrator: ExtratorDeLancamentos = vi.fn(async () => [
      lanc({
        data: "05/08/2026",
        descricao: "SALARIO ACME",
        valorCentavos: 400_000,
        direcao: "C",
        saldoCentavos: 400_000,
      }),
      lanc({
        data: "28/08/2026",
        descricao: "PAGAMENTO FATURA",
        valorCentavos: 50_000,
        direcao: "D",
        saldoCentavos: 350_000,
      }),
      lanc({
        data: "05/09/2026",
        descricao: "SALARIO ACME",
        valorCentavos: 400_000,
        direcao: "C",
        saldoCentavos: 750_000,
      }),
      lanc({
        data: "28/09/2026",
        descricao: "PAGAMENTO FATURA",
        valorCentavos: 50_000,
        direcao: "D",
        saldoCentavos: 700_000,
      }),
    ]);
    const r = await analisarExtratoComIa(EXTRATO_LAYOUT_DESCONHECIDO, {
      nomeArquivo: "extrato.pdf",
      extrator,
    });
    expect(extrator).toHaveBeenCalled();
    expect(r.fonteExtracao).toBe("ia");
    expect(r.lancamentos).toBe(4);
    expect(r.rendaComprovadaCentavos).toBe(400_000);
  });

  it("saldo que não fecha gera pendência com a diferença, não 'sem lançamentos'", async () => {
    const extrator: ExtratorDeLancamentos = vi.fn(async () => [
      lanc({
        data: "05/08/2026",
        descricao: "SALARIO ACME",
        valorCentavos: 100_000,
        direcao: "C",
        saldoCentavos: 100_000,
      }),
      lanc({
        data: "20/08/2026",
        descricao: "PIX TERCEIRO",
        valorCentavos: 50_000,
        direcao: "C",
        saldoCentavos: 900_000,
      }),
    ]);
    const r = await analisarExtratoComIa(
      `
Extrato
05/08/2026 PIX RECEBIDO EMPRESA A 1.000,00 C 1.000,00
20/08/2026 PIX RECEBIDO EMPRESA A 1.000,00 C 9.000,00
`.trim(),
      { nomeArquivo: "extrato-banco-x.pdf", extrator },
    );
    expect(r.lancamentos).toBeGreaterThan(0);
    expect(r.avisos.join(" ")).toMatch(/saldo não fechou/i);
    expect(r.avisos.join(" ")).toMatch(/Diferença/);
    expect(r.avisos.join(" ")).not.toMatch(/sem lançamentos legíveis/i);
    const conf = conferirSaldo(r.itens, {});
    expect(conf.fecha).toBe(false);
  });
});
