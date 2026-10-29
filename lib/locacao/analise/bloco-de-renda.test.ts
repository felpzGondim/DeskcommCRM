import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  TEXTO_BLOCO_RENDA_AUSENTE,
  aceitarBlocoDeRenda,
  lerBlocoDeRendaSalvo,
  montarBlocoDeRendaDoExtrato,
} from "@/lib/locacao/analise/bloco-de-renda";
import { aplicarRendaNaFicha } from "@/lib/locacao/analise/renda";
import { analisarExtrato, montarPacote } from "@/lib/locacao/extrato";
import { completarFicha, fichaVazia } from "@/lib/locacao/ficha-schema";

const EXTRATO = `
Extrato
Titular: TITULAR TESTE ALFA
05/08/2026 CREDITO SALARIO ACME C 5.000,00 5.000,00
10/08/2026 PIX RECEBIDO PAGADOR PF BETA C 800,00 5.800,00
12/08/2026 TED PROPRIA TITULAR TESTE ALFA C 200,00 6.000,00
15/08/2026 RESGATE POUPANCA C 400,00 6.400,00
28/08/2026 PAGAMENTO FATURA D 200,00 6.200,00
05/09/2026 CREDITO SALARIO ACME C 5.000,00 11.200,00
10/09/2026 PIX RECEBIDO PAGADOR PF BETA C 800,00 12.000,00
20/09/2026 ANTECIPACAO STONE C 2.200,00 14.200,00
28/09/2026 PAGAMENTO FATURA D 200,00 14.000,00
`.trim();

describe("bloco de renda do relatório — motor do #31", () => {
  it("declarada sozinha nunca vira comprovada", () => {
    const bloco = aceitarBlocoDeRenda({ declarada: 8000 });
    expect(bloco.comprovada).toBeNull();
    expect(bloco.declarada).toBe(8000);
    expect(bloco.comprovada).not.toBe(bloco.declarada);
    expect(bloco.motivo_nao_comprovacao).toBe(TEXTO_BLOCO_RENDA_AUSENTE);
    expect(bloco.tabela).toBeNull();
  });

  it("comprovada nula com declarada no mesmo objeto continua nula", () => {
    const bloco = aceitarBlocoDeRenda({
      comprovada: null,
      renda_declarada: 8000,
      tabela_mensal: "esta tabela não vale sem comprovada",
    });
    expect(bloco.comprovada).toBeNull();
    expect(bloco.declarada).toBe(8000);
    expect(bloco.comprovada).not.toBe(8000);
  });

  it("renda.mensal da ficha (preliminar ou 4.1) não conta como bloco calculado", () => {
    const ficha = completarFicha({
      renda: { mensal: { valor: 8000 }, proposta_fc: { valor: 8000 } },
    });
    const bloco = lerBlocoDeRendaSalvo(ficha);
    expect(bloco.comprovada).toBeNull();
    expect(bloco.comprovada).not.toBe(8000);
    expect(bloco.motivo_nao_comprovacao).toBe(TEXTO_BLOCO_RENDA_AUSENTE);
  });

  it("bloco com comprovada e tabela passa; declarada fica ao lado", () => {
    const bloco = aceitarBlocoDeRenda({
      comprovada: 4500,
      declarada: 8000,
      tabela: "Mês | Créditos brutos | Excluídos | Renda considerada\n2026-09 | 4500.00 | 0 | 4500.00",
      pacote: 2500,
      tres_vezes_pacote: 7500,
      abaixo_de_3x: true,
    });
    expect(bloco.comprovada).toBe(4500);
    expect(bloco.comprovada).not.toBe(8000);
    expect(bloco.declarada).toBe(8000);
    expect(bloco.tabela).toMatch(/4500/);
    expect(bloco.abaixo_de_3x).toBe(true);
    expect(bloco.motivo_nao_comprovacao).toBeNull();
  });

  it("o bloco sai da análise de extrato e do pacote do #31 (com seguro-incêndio)", () => {
    expect(existsSync("lib/locacao/extrato")).toBe(true);
    const src = readFileSync("lib/locacao/analise/bloco-de-renda.ts", "utf8");
    expect(src).toContain("montarPacote");
    expect(src).toContain("montarBlocoDeRendaDasAnalises");
    expect(src).not.toMatch(/comprovada\s*=\s*declarada|comprovada:\s*declarada|comprovada\s*\?\?\s*declarada/);
    expect(src).not.toMatch(/PROMPT_|lancamentosDoTexto|classeDoLancamento|from ["']@\/lib\/locacao\/analise\/regras["']/);
    const relatorio = readFileSync("lib/locacao/analise/relatorio.ts", "utf8");
    expect(relatorio).toMatch(/aluguel \+ condomínio \+ IPTU \+ seguro-incêndio/);
    expect(relatorio).not.toMatch(/lancamentosDoTexto|PROMPT_RENDA|detectarExtrato|corrigirRendaDaFicha/);

    const analise = analisarExtrato(EXTRATO);
    const pacote = montarPacote({
      conversa: {
        aluguelCentavos: 200_000,
        condominioCentavos: 50_000,
        iptuCentavos: 20_000,
        seguroIncendioCentavos: 10_000,
      },
    });
    const bloco = montarBlocoDeRendaDoExtrato([analise], { pacote, declarada: 9000 });
    expect(bloco.comprovada).toBe((analise.rendaComprovadaCentavos ?? 0) / 100);
    expect(bloco.comprovada).not.toBe(9000);
    expect(bloco.declarada).toBe(9000);
    expect(bloco.pacote).toBe(2800);
    expect(bloco.tres_vezes_pacote).toBe(8400);
    expect(bloco.tabela).toMatch(/Renda comprovada/);

    const ficha = aplicarRendaNaFicha(fichaVazia(), { analises: [analise], declarada: 9000, pacote });
    const lido = lerBlocoDeRendaSalvo(ficha);
    expect(lido.comprovada).toBe(bloco.comprovada);
    expect(lido.pacote).toBe(2800);
  });
});
