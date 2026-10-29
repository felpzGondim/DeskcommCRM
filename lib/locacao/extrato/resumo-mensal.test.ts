import { describe, expect, it } from "vitest";

import { analisarExtrato } from "./analisar";
import { classificarLancamentos } from "./classificar";
import { lerLancamentos } from "./lancamentos";
import { EXTRATO_STONE_SINTETICO } from "./texto-sintetico";
import { resumirMeses, textoDoResumoParaIa } from "./resumo-mensal";

describe("resumo mensal do extrato", () => {
  it("PIX de terceiro e cartão entram; próprias, resgate, estorno e empréstimo saem", () => {
    const leitura = lerLancamentos(EXTRATO_STONE_SINTETICO);
    const classificados = classificarLancamentos(leitura.lancamentos, leitura.titular);
    const resumo = resumirMeses(classificados, { periodo: leitura.periodo });
    expect(resumo.linhas.map((l) => l.mes)).toEqual(["2026-08", "2026-09"]);
    const ago = resumo.linhas[0];
    expect(ago?.excluidos.propria).toBeUndefined();
    expect(ago?.excluidos.resgate_aplicacao).toBe(100_000);
    expect(ago?.excluidos.estorno_devolucao).toBe(20_000);
    expect(ago?.excluidos.emprestimo).toBe(300_000);
    expect(ago?.rendaConsideradaCentavos).toBe(530_000);
    expect(ago?.pixTerceirosCentavos).toBe(530_000);
    const set = resumo.linhas[1];
    expect(set?.vendasCartaoCentavos).toBe(220_000);
    expect(set?.rendaConsideradaCentavos).toBe(750_000);
    expect(resumo.rendaComprovadaCentavos).toBe(640_000);
    expect(resumo.volumePixTerceirosCentavos).toBe(1_060_000);
    expect(resumo.volumeVendasCartaoCentavos).toBe(220_000);
    expect(ago?.pagadoresRecorrentes.some((p) => p.meses >= 2 && p.mascara.endsWith("***"))).toBe(
      true,
    );
    expect(ago?.entradasPorFonte.length).toBeGreaterThan(0);
    expect(textoDoResumoParaIa(resumo, 2)).toMatch(/Renda comprovada/);
    expect(textoDoResumoParaIa(resumo, 2)).toMatch(/vendas no cartão|Vendas no cartão/i);
    expect(textoDoResumoParaIa(resumo, 2)).not.toMatch(/529\.982\.247-25/);
    expect(textoDoResumoParaIa(resumo, 2)).not.toMatch(/TITULAR TESTE ALFA/);
  });

  it("vendas no cartão sozinhas comprovam renda (recebimento de cliente)", () => {
    const r = analisarExtrato(
      `
STONE INSTITUIÇÃO DE PAGAMENTO S.A.
Titular: TITULAR TESTE ALFA
05/08/2026 ANTECIPACAO STONE 2.200,00 C 2.200,00
20/08/2026 VENDAS NO CARTAO 3.000,00 C 5.200,00
28/08/2026 PAGAMENTO FATURA 500,00 D 4.700,00
`.trim(),
    );
    expect(r.rendaComprovadaCentavos).toBe(520_000);
    expect(r.resumo.volumeVendasCartaoCentavos).toBe(520_000);
    expect(r.avisos.join(" ")).toMatch(/cartão/i);
  });

  it("só resgate/estorno não vira renda comprovada", () => {
    const r = analisarExtrato(
      `
Extrato
05/08/2026 RESGATE RENDA FIXA 2.000,00 C 2.000,00
20/08/2026 ESTORNO PIX 300,00 C 2.300,00
28/08/2026 PAGAMENTO FATURA 100,00 D 2.200,00
`.trim(),
    );
    expect(r.rendaComprovadaCentavos).toBeNull();
    expect(r.motivoSemRenda).toBe("so_negocio");
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

  it("PIX de terceiro PF entra na comprovada, com recorrência", () => {
    const r = analisarExtrato(
      `
Extrato
Titular: TITULAR TESTE ALFA
05/08/2026 CREDITO SALARIO ACME C 5.000,00 5.000,00
10/08/2026 PIX RECEBIDO PAGADOR PF BETA C 800,00 5.800,00
28/08/2026 PAGAMENTO FATURA D 200,00 5.600,00
05/09/2026 CREDITO SALARIO ACME C 5.000,00 10.600,00
10/09/2026 PIX RECEBIDO PAGADOR PF BETA C 800,00 11.400,00
28/09/2026 PAGAMENTO FATURA D 200,00 11.200,00
`.trim(),
    );
    expect(r.rendaComprovadaCentavos).toBe(580_000);
    expect(r.resumo.volumePixTerceirosCentavos).toBe(160_000);
    expect(r.itens.some((i) => i.classe === "salario_prolabore")).toBe(true);
    const beta = r.resumo.recorrenciaPagadores.find((p) => p.mascara.startsWith("PAGA"));
    expect(beta?.meses).toEqual(["2026-08", "2026-09"]);
    expect(beta?.lancamentos).toBe(2);
  });

  it("terceiro avulso entra na comprovada e aparece na recorrência com 1 mês", () => {
    const r = analisarExtrato(
      `
Extrato
Titular: TITULAR TESTE ALFA
05/08/2026 CREDITO SALARIO ACME C 4.000,00 4.000,00
12/08/2026 PIX RECEBIDO CLIENTE AVULSO GAMA C 1.500,00 5.500,00
28/08/2026 PAGAMENTO FATURA D 100,00 5.400,00
05/09/2026 CREDITO SALARIO ACME C 4.000,00 9.400,00
28/09/2026 PAGAMENTO FATURA D 100,00 9.300,00
`.trim(),
    );
    expect(r.rendaComprovadaCentavos).toBe(475_000);
    const avulso = r.resumo.recorrenciaPagadores.find((p) => p.mascara.startsWith("CLIE"));
    expect(avulso?.meses).toEqual(["2026-08"]);
    expect(avulso?.lancamentos).toBe(1);
    expect(avulso?.totalCentavos).toBe(150_000);
    expect(r.resumo.linhas[0]?.pagadoresRecorrentes.some((p) => p.lancamentos >= 1)).toBe(true);
  });

  it("detecta aluguel atual por recorrência e monta o balanço mensal", () => {
    const r = analisarExtrato(
      `
Extrato
05/08/2026 CREDITO SALARIO ACME C 4.000,00 4.000,00
10/08/2026 PIX ENVIADO ALUGUEL IMOBILIARIA GAMA D 1.200,00 2.800,00
28/08/2026 PAGAMENTO FATURA D 100,00 2.700,00
05/09/2026 CREDITO SALARIO ACME C 4.000,00 6.700,00
10/09/2026 PIX ENVIADO ALUGUEL IMOBILIARIA GAMA D 1.200,00 5.500,00
28/09/2026 PAGAMENTO FATURA D 100,00 5.400,00
`.trim(),
    );
    expect(r.resumo.aluguelAtual.encontrado).toBe(true);
    expect(r.resumo.aluguelAtual.valorCentavos).toBe(120_000);
    expect(r.resumo.linhas[0]?.creditosBrutosCentavos).toBe(400_000);
    expect(r.resumo.linhas[0]?.saidasCentavos).toBe(130_000);
  });

  it("cônjuge e pai da ficha saem da comprovada e o volume é informado", () => {
    const r = analisarExtrato(
      `
Extrato
Titular: TITULAR TESTE ALFA
05/08/2026 CREDITO SALARIO ACME C 4.000,00 4.000,00
12/08/2026 PIX RECEBIDO CONJUGE TESTE BETA C 2.000,00 6.000,00
18/08/2026 PIX RECEBIDO JOAO ALFA PAI C 1.000,00 7.000,00
28/08/2026 PAGAMENTO FATURA D 100,00 6.900,00
05/09/2026 CREDITO SALARIO ACME C 4.000,00 10.900,00
12/09/2026 PIX RECEBIDO CONJUGE TESTE BETA C 2.000,00 12.900,00
18/09/2026 PIX RECEBIDO JOAO ALFA PAI C 1.000,00 13.900,00
28/09/2026 PAGAMENTO FATURA D 100,00 13.800,00
`.trim(),
      {
        familiares: [
          { nome: "CONJUGE TESTE BETA", cpfDigits: "11144477735", papel: "conjuge" },
          { nome: "JOAO ALFA PAI", cpfDigits: null, papel: "parente" },
        ],
      },
    );
    expect(r.rendaComprovadaCentavos).toBe(400_000);
    expect(r.resumo.volumeConjugeCentavos).toBe(400_000);
    expect(r.resumo.volumeFamiliarCentavos).toBe(600_000);
    expect(r.avisos.join(" ")).toMatch(/familiares diretos/i);
    expect(r.itens.filter((i) => i.classe === "familiar").length).toBe(2);
  });

  it("sobrenome comum sai da comprovada, entra na renda com prováveis e na lista de conferir", () => {
    const r = analisarExtrato(
      `
Extrato
Titular: MARIA SILVA
05/08/2026 CREDITO SALARIO ACME C 4.000,00 4.000,00
12/08/2026 PIX RECEBIDO PEDRO SILVA C 1.200,00 5.200,00
28/08/2026 PAGAMENTO FATURA D 100,00 5.100,00
05/09/2026 CREDITO SALARIO ACME C 4.000,00 9.100,00
12/09/2026 PIX RECEBIDO PEDRO SILVA C 1.200,00 10.300,00
28/09/2026 PAGAMENTO FATURA D 100,00 10.200,00
`.trim(),
    );
    expect(r.rendaComprovadaCentavos).toBe(400_000);
    expect(r.resumo.rendaComProvaveisCentavos).toBe(520_000);
    expect(r.resumo.volumeFamiliarProvavelCentavos).toBe(240_000);
    expect(r.resumo.familiaresProvaveis[0]?.motivo).toBe("sobrenome_comum");
    expect(r.avisos.join(" ")).toMatch(/familiar provável — conferir/i);
    expect(textoDoResumoParaIa(r.resumo, null)).toMatch(/Renda com familiares prováveis/);
  });
});
