import { describe, expect, it } from "vitest";

import { lerLancamentos, pareceExtrato } from "./lancamentos";
import { EXTRATO_STONE_SINTETICO } from "./texto-sintetico";

const EXTRATO_GENERICO_CD = `
Extrato bancário
Titular: TITULAR TESTE ALFA
01/08/2026 CREDITO SALARIO ACME C 4.500,00 9.000,00
08/08/2026 DEBITO PIX ALUGUEL D 1.200,00 7.800,00
20/08/2026 CREDITO PIX TERCEIRO C 300,00 8.100,00
`.trim();

describe("ler lançamentos do extrato", () => {
  it("lê o layout Stone e o titular sem expor o CPF na lista", () => {
    const r = lerLancamentos(EXTRATO_STONE_SINTETICO);
    expect(r.layout).toBe("stone");
    expect(r.pareceExtrato).toBe(true);
    expect(r.titular.nome).toMatch(/TITULAR TESTE ALFA/i);
    expect(r.titular.cpfDigits).toBe("52998224725");
    expect(r.periodo.inicio).toBe("01/08/2026");
    expect(r.lancamentos.length).toBeGreaterThanOrEqual(10);
    const primeiro = r.lancamentos.find((l) => l.descricao.includes("EMPRESA FOLHA"));
    expect(primeiro?.direcao).toBe("C");
    expect(primeiro?.valorCentavos).toBe(450_000);
    expect(JSON.stringify(r.lancamentos.map((l) => l.descricao))).not.toMatch(/529\.982\.247-25/);
  });

  it("lê o layout genérico C/D", () => {
    const r = lerLancamentos(EXTRATO_GENERICO_CD);
    expect(r.layout).toBe("generico");
    expect(r.lancamentos).toHaveLength(3);
    expect(r.lancamentos[0]).toMatchObject({ direcao: "C", valorCentavos: 450_000 });
    expect(r.lancamentos[1]).toMatchObject({ direcao: "D", valorCentavos: 120_000 });
  });

  it("junta data numa linha e valor na seguinte", () => {
    const r = lerLancamentos(
      `
Extrato
01/08/2026 PIX RECEBIDO EMPRESA FOLHA LTDA
4.500,00 C
`.trim(),
    );
    expect(r.lancamentos).toHaveLength(1);
    expect(r.lancamentos[0]?.valorCentavos).toBe(450_000);
    expect(r.lancamentos[0]?.direcao).toBe("C");
  });

  it("marca página faltando pela numeração", () => {
    const r = lerLancamentos(
      `
Extrato
Página 1 de 3
05/08/2026 PIX RECEBIDO EMPRESA FOLHA LTDA 4.500,00 C 4.500,00

Página 3 de 3
05/09/2026 PIX RECEBIDO EMPRESA FOLHA LTDA 4.500,00 C 9.000,00
`.trim(),
    );
    expect(r.paginasFaltando).toBe(true);
    expect(r.avisos.join(" ")).toMatch(/[Pp]ágina faltando/);
  });

  it("marca página faltando quando o saldo não fecha entre páginas", () => {
    const r = lerLancamentos(
      `
Extrato
05/08/2026 PIX RECEBIDO EMPRESA A 1.000,00 C 1.000,00

05/09/2026 PIX RECEBIDO EMPRESA A 1.000,00 C 9.000,00
`.trim(),
    );
    expect(r.paginasFaltando).toBe(true);
  });

  it("não lê PDF de RG como extrato", () => {
    const texto = "REPÚBLICA FEDERATIVA DO BRASIL\nCarteira de identidade\nNOME: FULANO";
    expect(pareceExtrato(texto, "rg.pdf")).toBe(false);
    expect(lerLancamentos(texto).lancamentos).toHaveLength(0);
  });

  it("filename extrato conta mesmo sem a marca Stone", () => {
    expect(pareceExtrato("saldo e lançamentos", "extrato-agosto.pdf")).toBe(true);
  });
});
