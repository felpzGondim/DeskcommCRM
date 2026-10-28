import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent-engine/edge/llm/run-model-call", () => ({
  runModelCall: vi.fn(),
}));

import { runModelCall } from "@/lib/agent-engine/edge/llm/run-model-call";
import {
  blocoDasFontesDaFicha,
  fontesDaFicha,
} from "@/lib/agent-engine/agent/painel-relatorio-preliminar";
import { fichaVazia } from "@/lib/locacao/ficha-schema";
import {
  AnaliseRendaTruncada,
  analisarRendaNoModelo,
  aplicarRendaNaFicha,
  consolidarLancamentos,
  PURPOSE_PAINEL_ANALISE,
  SYSTEM_DA_ANALISE_DE_RENDA,
  TETO_SAIDA_ANALISE_RENDA,
} from "@/lib/locacao/analise/renda";
import { aplicarRegrasDaRenda, type LancamentoDaRenda } from "@/lib/locacao/analise/regras";

describe("análise de renda no modelo", () => {
  it("o prompt proíbe envio ao cliente, FC, contrato e alugue/não alugue", () => {
    expect(SYSTEM_DA_ANALISE_DE_RENDA).toMatch(/Nunca envie mensagem/);
    expect(SYSTEM_DA_ANALISE_DE_RENDA).toMatch(/FC Score\+/);
    expect(SYSTEM_DA_ANALISE_DE_RENDA).toMatch(/alugue/);
    expect(SYSTEM_DA_ANALISE_DE_RENDA).toMatch(/Autotransferência/);
    expect(SYSTEM_DA_ANALISE_DE_RENDA).toMatch(/Rende Fácil/);
  });

  it("a análise reabre os PDFs originais em vez de depender só do derivado cortado", () => {
    const analise = readFileSync("lib/painel/acoes/analise.ts", "utf8");
    expect(analise).toContain("enriquecerAnexosDaAnalise");
    expect(analise).toContain("limitesDaAnalise");
    const leitura = readFileSync("lib/agent-engine/agent/painel-leitura-anexos.ts", "utf8");
    expect(leitura).toContain("lerPdfsOriginais");
    expect(leitura).toContain("export async function enriquecerAnexosDaAnalise");
  });

  it("extrato longo cortado em 8 mil reabre o trecho que ficou de fora", () => {
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

  it("finishReason length vira erro claro", async () => {
    vi.mocked(runModelCall).mockResolvedValue({
      result: { text: "{", finishReason: "length" },
      callId: "c1",
    } as never);
    await expect(
      analisarRendaNoModelo({} as never, {} as never, {
        tenantId: "org",
        contactId: "c",
        fontes: "M1 salario 1000",
      }),
    ).rejects.toBeInstanceOf(AnaliseRendaTruncada);
    expect(runModelCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        purpose: PURPOSE_PAINEL_ANALISE,
        maxOutputTokens: TETO_SAIDA_ANALISE_RENDA,
      }),
      expect.anything(),
    );
  });

  it("grava na ficha comprovada, proposta, exclusões e evidências", () => {
    const lancamentos: LancamentoDaRenda[] = [
      {
        descricao: "Salário",
        valor: 4000,
        data: null,
        fonte: "M1",
        trecho: "Salário 4000",
        classe: "renda_recorrente",
      },
      {
        descricao: "PIX recebido de terceiro Ana",
        valor: 100,
        data: null,
        fonte: "M2",
        trecho: "PIX terceiro",
        classe: "pix_terceiros",
      },
    ];
    const regras = aplicarRegrasDaRenda(lancamentos);
    const ficha = aplicarRendaNaFicha(fichaVazia(), regras, [
      { trecho: "Salário 4000", fonte: "M1" },
    ]);
    expect(ficha.renda.mensal.valor).toBe(4000);
    expect(ficha.renda.proposta_fc.valor).toBe(4000);
    expect(ficha.renda.pix_terceiros).toHaveLength(1);
    expect(ficha.renda.evidencias[0]?.fonte).toBe("M1");
  });

  it("consolidarLancamentos acrescenta exclusão que o modelo pulou", () => {
    const doModelo: LancamentoDaRenda[] = [
      {
        descricao: "Salário",
        valor: 2000,
        data: null,
        fonte: "M1",
        trecho: "Salário",
        classe: "renda_recorrente",
      },
    ];
    const texto = "Salário R$ 2.000,00\nRende Fácil aplicação R$ 50,00";
    const juntos = consolidarLancamentos(doModelo, texto);
    expect(juntos.some((l) => l.classe === "rende_facil")).toBe(true);
    expect(juntos.filter((l) => l.classe === "renda_recorrente")).toHaveLength(1);
  });
});
