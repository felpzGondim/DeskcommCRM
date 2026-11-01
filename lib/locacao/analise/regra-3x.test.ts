import { describe, expect, it } from "vitest";

import { analisarExtrato, montarPacote } from "@/lib/locacao/extrato";
import { aplicarRendaNaFicha } from "@/lib/locacao/analise/renda";
import {
  FRASE_3X_ABAIXO,
  FRASE_3X_COBRE,
  FRASE_3X_SEM_PACOTE,
  avaliarRegra3x,
  pacoteDaRegra3x,
  textoDasExclusoes3x,
} from "@/lib/locacao/analise/regra-3x";
import { fichaVazia } from "@/lib/locacao/ficha-schema";

const EXTRATO = `
Extrato
Titular: TITULAR TESTE ALFA
05/08/2026 CREDITO SALARIO ACME C 5.000,00 5.000,00
10/08/2026 PIX RECEBIDO PAGADOR PF BETA C 800,00 5.800,00
12/08/2026 TED PROPRIA TITULAR TESTE ALFA C 200,00 6.000,00
15/08/2026 RESGATE POUPANCA C 400,00 6.400,00
18/08/2026 ESTORNO PIX C 50,00 6.450,00
19/08/2026 EMPRESTIMO PESSOAL C 300,00 6.750,00
28/08/2026 PAGAMENTO FATURA D 200,00 6.550,00
05/09/2026 CREDITO SALARIO ACME C 5.000,00 11.550,00
10/09/2026 PIX RECEBIDO PAGADOR PF BETA C 800,00 12.350,00
12/09/2026 TED PROPRIA TITULAR TESTE ALFA C 200,00 12.550,00
15/09/2026 RESGATE POUPANCA C 400,00 12.950,00
18/09/2026 ESTORNO PIX C 50,00 13.000,00
19/09/2026 EMPRESTIMO PESSOAL C 300,00 13.300,00
28/09/2026 PAGAMENTO FATURA D 200,00 13.100,00
`.trim();

describe("regra 3×", () => {
  it("3 × (aluguel + condomínio + IPTU + seguro-incêndio); seguro-fiança não entra", () => {
    const { pacote, tres_vezes } = pacoteDaRegra3x({
      aluguel: 2000,
      condominio: 500,
      iptu: 200,
      seguro_incendio: 100,
      seguro_fianca: 900,
    });
    expect(pacote).toBe(2800);
    expect(tres_vezes).toBe(8400);
    expect(pacoteDaRegra3x({
      aluguel: null,
      condominio: 500,
      iptu: 200,
      seguro_incendio: 100,
    }).tres_vezes).toBeNull();
  });

  it("compara a comprovada com o 3× e lista as exclusões com volume", () => {
    const abaixo = avaliarRegra3x({
      aluguel: 2000,
      condominio: 500,
      iptu: 200,
      seguro_incendio: 100,
      seguro_fianca: 900,
      comprovada: 5800,
      exclusoes: {
        propria: [{ descricao: "TED PROPRIA TITULAR TESTE ALFA", valor: 200 }],
        familiar: [{ descricao: "PIX CONJUGE TESTE BETA", valor: 1500 }],
        poupanca: [{ descricao: "RESGATE POUPANCA", valor: 400 }],
        estorno: [{ descricao: "ESTORNO PIX", valor: 50 }],
        emprestimo: [{ descricao: "EMPRESTIMO PESSOAL", valor: 300 }],
        familiar_provavel: [{ descricao: "PIX JOAO SOBRENOMECOMUM", valor: 100 }],
      },
    });
    expect(abaixo.tres_vezes).toBe(8400);
    expect(abaixo.cobre).toBe(false);
    expect(abaixo.frase).toBe(FRASE_3X_ABAIXO);
    expect(abaixo.exclusoes.map((e) => e.motivo)).toEqual([
      "propria",
      "familiar",
      "familiar_provavel",
      "poupanca",
      "estorno",
      "emprestimo",
    ]);
    expect(textoDasExclusoes3x(abaixo.exclusoes)).toMatch(/próprias/);
    expect(textoDasExclusoes3x(abaixo.exclusoes)).toMatch(/familiares/);
    expect(textoDasExclusoes3x(abaixo.exclusoes)).toMatch(/poupança/);
    expect(textoDasExclusoes3x(abaixo.exclusoes)).toMatch(/estornos/);
    expect(textoDasExclusoes3x(abaixo.exclusoes)).toMatch(/empréstimos/);
    expect(textoDasExclusoes3x(abaixo.exclusoes)).toMatch(/familiar provável/);

    const cobre = avaliarRegra3x({
      aluguel: 1000,
      condominio: 0,
      iptu: 0,
      seguro_incendio: 0,
      comprovada: 4000,
    });
    expect(cobre.tres_vezes).toBe(3000);
    expect(cobre.cobre).toBe(true);
    expect(cobre.frase).toBe(FRASE_3X_COBRE);
    expect(cobre.exclusoes).toEqual([]);
  });

  it("sem aluguel não inventa 3×; seguro-fiança no input não muda o pacote", () => {
    const sem = avaliarRegra3x({
      aluguel: null,
      condominio: 400,
      iptu: 100,
      seguro_incendio: 50,
      seguro_fianca: 2000,
      comprovada: 9000,
    });
    expect(sem.pacote).toBeNull();
    expect(sem.tres_vezes).toBeNull();
    expect(sem.cobre).toBeNull();
    expect(sem.frase).toBe(FRASE_3X_SEM_PACOTE);
  });

  it("o motor do extrato e a ficha usam a mesma regra: PIX de terceiro entra; exclusões saem", () => {
    const analise = analisarExtrato(EXTRATO);
    const pacote = montarPacote({
      conversa: {
        aluguelCentavos: 200_000,
        condominioCentavos: 50_000,
        iptuCentavos: 20_000,
        seguroIncendioCentavos: 10_000,
      },
    });
    const ficha = aplicarRendaNaFicha(fichaVazia(), { analises: [analise], pacote });
    expect(ficha.renda.excluida.autotransferencias.length).toBeGreaterThan(0);
    expect(ficha.renda.excluida.poupanca.length).toBeGreaterThan(0);
    expect(ficha.renda.excluida.estornos.length).toBeGreaterThan(0);
    expect(ficha.renda.excluida.emprestimos.length).toBeGreaterThan(0);
    expect(ficha.renda.pix_terceiros.length).toBeGreaterThan(0);
    const regra = avaliarRegra3x({
      aluguel: 2000,
      condominio: 500,
      iptu: 200,
      seguro_incendio: 100,
      comprovada: ficha.renda.mensal.valor,
      exclusoes: {
        propria: ficha.renda.excluida.autotransferencias,
        familiar: ficha.renda.excluida.familiares,
        familiar_provavel: ficha.renda.excluida.familiares_provaveis,
        poupanca: [...ficha.renda.excluida.poupanca, ...ficha.renda.excluida.rende_facil],
        estorno: ficha.renda.excluida.estornos,
        emprestimo: ficha.renda.excluida.emprestimos,
      },
    });
    expect(regra.tres_vezes).toBe(8400);
    expect(regra.comprovada).toBe(ficha.renda.bloco_calculado?.comprovada);
    expect(regra.exclusoes.some((e) => e.motivo === "propria" && e.volume > 0)).toBe(true);
    expect(regra.exclusoes.some((e) => e.motivo === "poupanca" && e.volume > 0)).toBe(true);
    expect(regra.exclusoes.some((e) => e.motivo === "estorno" && e.volume > 0)).toBe(true);
    expect(regra.exclusoes.some((e) => e.motivo === "emprestimo" && e.volume > 0)).toBe(true);
  });
});
