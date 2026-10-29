import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  blocoDasFontesDaFicha,
  fontesDaFicha,
} from "@/lib/agent-engine/agent/painel-relatorio-preliminar";
import { aplicarRendaNaFicha } from "@/lib/locacao/analise/renda";
import { analisarExtrato, montarPacote } from "@/lib/locacao/extrato";
import { fichaVazia } from "@/lib/locacao/ficha-schema";

const EXTRATO_DOIS_MESES = `
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

describe("análise de renda no motor do extrato", () => {
  it("a análise reabre os PDFs originais e prepara as fontes pelo motor do #31", () => {
    const analise = readFileSync("lib/painel/acoes/analise.ts", "utf8");
    expect(analise).toContain("enriquecerAnexosDaAnalise");
    expect(analise).toContain("limitesDaAnalise");
    expect(analise).toContain("prepararFontesDoRelatorio");
    expect(analise).toContain("criarExtratorComModelo");
    expect(analise).toContain("familiaresDaFicha");
    expect(analise).not.toMatch(/analisarRendaNoModelo/);
    expect(analise).not.toMatch(/from ["']@\/lib\/locacao\/analise\/regras["']/);
    const renda = readFileSync("lib/locacao/analise/renda.ts", "utf8");
    expect(renda).not.toMatch(/from ["']@\/lib\/locacao\/analise\/regras["']/);
    expect(renda).toContain("lib/locacao/extrato");
    const leitura = readFileSync("lib/agent-engine/agent/painel-leitura-anexos.ts", "utf8");
    expect(leitura).toContain("lerPdfsOriginais");
    expect(leitura).toContain("export async function enriquecerAnexosDaAnalise");
  });

  it("extrato longo vira tabela calculada — o chars_conjunto não vê o texto bruto", () => {
    const marcador = "PIX recebido de terceiro Extra R$ 321,00";
    const derivadoCortado = `${"x".repeat(8000)}`;
    expect(derivadoCortado).not.toContain(marcador);
    const original = `${"y".repeat(8100)}\n${marcador}`;
    expect(original.length).toBeGreaterThan(8000);
    const fontes = fontesDaFicha([
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        type: "document",
        direction: "inbound",
        media_derived_status: "ready",
        media_derived_text: original,
        original_completo: true,
        metadata: { media_filename: "extrato.pdf" },
      },
    ]);
    const bloco = blocoDasFontesDaFicha(fontes);
    expect(bloco).toContain(marcador);
    expect(bloco).not.toContain(derivadoCortado.slice(0, 40));
  });

  it("PIX/TED de terceiro e cartão entram; próprias e resgate saem; bloco_calculado grava 3×", () => {
    const analise = analisarExtrato(EXTRATO_DOIS_MESES);
    expect(analise.rendaComprovadaCentavos).not.toBeNull();
    const pacote = montarPacote({
      conversa: {
        aluguelCentavos: 200_000,
        condominioCentavos: 50_000,
        iptuCentavos: 20_000,
        seguroIncendioCentavos: 10_000,
      },
    });
    const ficha = aplicarRendaNaFicha(fichaVazia(), {
      analises: [analise],
      declarada: 9000,
      pacote,
    });
    expect(ficha.renda.mensal.valor).toBe((analise.rendaComprovadaCentavos ?? 0) / 100);
    expect(ficha.renda.proposta_fc.valor).toBe(ficha.renda.mensal.valor);
    expect(ficha.renda.pix_terceiros.length).toBeGreaterThan(0);
    expect(ficha.renda.vendas_cartao.length).toBeGreaterThan(0);
    expect(ficha.renda.excluida.autotransferencias.length).toBeGreaterThan(0);
    expect(ficha.renda.excluida.poupanca.length + ficha.renda.excluida.rende_facil.length).toBeGreaterThan(
      0,
    );
    expect(ficha.renda.bloco_calculado?.comprovada).toBe(ficha.renda.mensal.valor);
    expect(ficha.renda.bloco_calculado?.declarada).toBe(9000);
    expect(ficha.renda.bloco_calculado?.pacote).toBe(2800);
    expect(ficha.renda.bloco_calculado?.tres_vezes_pacote).toBe(8400);
    expect(ficha.renda.bloco_calculado?.tabela).toMatch(/Renda comprovada/);
    expect(ficha.renda.bloco_calculado?.motivo_nao_comprovacao).toBeNull();
  });

  it("sem comprovação a mensal fica null e o declarado não preenche o buraco", () => {
    const analise = analisarExtrato(
      `
Extrato
05/08/2026 RESGATE RENDA FIXA 2.000,00 C 2.000,00
20/08/2026 ESTORNO PIX 300,00 C 2.300,00
28/08/2026 PAGAMENTO FATURA 100,00 D 2.200,00
`.trim(),
    );
    const ficha = aplicarRendaNaFicha(fichaVazia(), {
      analises: [analise],
      declarada: 4500,
    });
    expect(ficha.renda.mensal.valor).toBeNull();
    expect(ficha.renda.proposta_fc.valor).toBeNull();
    expect(ficha.renda.bloco_calculado?.comprovada).toBeNull();
    expect(ficha.renda.bloco_calculado?.declarada).toBe(4500);
    expect(ficha.renda.bloco_calculado?.motivo_nao_comprovacao).toMatch(/não há renda|Não estime/i);
    expect(ficha.renda.alertas.join(" ")).toMatch(/declarada não é comprovada/i);
  });

  it("familiar da ficha sai; familiar provável fica sinalizado com renda com e sem", () => {
    const analise = analisarExtrato(
      `
Extrato
Titular: TITULAR TESTE ALFA
05/08/2026 CREDITO SALARIO ACME C 4.000,00 4.000,00
12/08/2026 PIX RECEBIDO CONJUGE TESTE BETA C 2.000,00 6.000,00
18/08/2026 PIX RECEBIDO JOAO SOBRENOMECOMUM C 1.000,00 7.000,00
28/08/2026 PAGAMENTO FATURA D 100,00 6.900,00
05/09/2026 CREDITO SALARIO ACME C 4.000,00 10.900,00
12/09/2026 PIX RECEBIDO CONJUGE TESTE BETA C 2.000,00 12.900,00
18/09/2026 PIX RECEBIDO JOAO SOBRENOMECOMUM C 1.000,00 13.900,00
28/09/2026 PAGAMENTO FATURA D 100,00 13.800,00
`.trim(),
      {
        familiares: [
          { nome: "CONJUGE TESTE BETA", cpfDigits: null, papel: "conjuge" },
        ],
      },
    );
    const ficha = aplicarRendaNaFicha(fichaVazia(), { analises: [analise] });
    expect(ficha.renda.excluida.familiares.length).toBeGreaterThan(0);
    expect(ficha.renda.mensal.valor).not.toBeNull();
    if (ficha.renda.excluida.familiares_provaveis.length > 0) {
      expect(ficha.renda.alertas.join(" ")).toMatch(/Familiar provável/i);
    }
  });
});
