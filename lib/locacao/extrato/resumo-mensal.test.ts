import { describe, expect, it } from "vitest";

import { analisarExtrato } from "./analisar";
import { classificarLancamentos } from "./classificar";
import { lerLancamentos } from "./lancamentos";
import { EXTRATO_STONE_SINTETICO } from "./texto-sintetico";
import { resumirMeses, textoDoResumoParaIa } from "./resumo-mensal";

describe("resumo mensal do extrato", () => {
  it("monta a tabela e a renda considerada sem próprias, estorno, resgate, empréstimo e cartão", () => {
    const leitura = lerLancamentos(EXTRATO_STONE_SINTETICO);
    const classificados = classificarLancamentos(leitura.lancamentos, leitura.titular);
    const resumo = resumirMeses(classificados, { periodo: leitura.periodo });
    expect(resumo.linhas.map((l) => l.mes)).toEqual(["2026-08", "2026-09"]);
    const ago = resumo.linhas[0];
    expect(ago?.excluidos.propria).toBeUndefined();
    expect(ago?.excluidos.resgate_aplicacao).toBe(100_000);
    expect(ago?.excluidos.estorno_devolucao).toBe(20_000);
    expect(ago?.excluidos.emprestimo).toBe(300_000);
    expect(ago?.rendaConsideradaCentavos).toBe(450_000 + 80_000);
    const set = resumo.linhas[1];
    expect(set?.excluidos.venda_cartao).toBe(220_000);
    expect(set?.rendaConsideradaCentavos).toBe(450_000 + 80_000);
    expect(resumo.rendaComprovadaCentavos).toBe(530_000);
    expect(ago?.pagadoresRecorrentes.some((p) => p.meses >= 2 && p.mascara.endsWith("***"))).toBe(
      true,
    );
    expect(textoDoResumoParaIa(resumo, 2)).toMatch(/Renda comprovada/);
    expect(textoDoResumoParaIa(resumo, 2)).not.toMatch(/529\.982\.247-25/);
    expect(textoDoResumoParaIa(resumo, 2)).not.toMatch(/TITULAR TESTE ALFA/);
  });

  it("não estima renda só com movimento de negócio", () => {
    const r = analisarExtrato(
      `
STONE INSTITUIÇÃO DE PAGAMENTO S.A.
Titular: TITULAR TESTE ALFA
05/08/2026 ANTECIPACAO STONE 2.200,00 C 2.200,00
20/08/2026 VENDAS NO CARTAO 3.000,00 C 5.200,00
28/08/2026 PAGAMENTO FATURA 500,00 D 4.700,00
`.trim(),
    );
    expect(r.rendaComprovadaCentavos).toBeNull();
    expect(r.motivoSemRenda).toBe("so_negocio");
    expect(r.avisos.join(" ")).toMatch(/negócio/);
  });

  it("PDF escaneado sem lançamento não estima", () => {
    const r = analisarExtrato("mancha ilegível", {
      nomeArquivo: "extrato.pdf",
      escaneado: true,
    });
    expect(r.ehExtrato).toBe(true);
    expect(r.lancamentos).toBe(0);
    expect(r.rendaComprovadaCentavos).toBeNull();
    expect(r.motivoSemRenda).toBe("escaneado");
    expect(r.avisos.join(" ")).toMatch(/escaneado/);
    expect(r.avisos.join(" ")).not.toMatch(/R\$/);
  });

  it("mês parcial não vira média", () => {
    const r = analisarExtrato(
      `
Extrato
20/08/2026 PIX RECEBIDO EMPRESA FOLHA LTDA 4.500,00 C 4.500,00
`.trim(),
    );
    expect(r.resumo.linhas[0]?.cobertura).toBe("parcial");
    expect(r.rendaComprovadaCentavos).toBeNull();
  });
});
