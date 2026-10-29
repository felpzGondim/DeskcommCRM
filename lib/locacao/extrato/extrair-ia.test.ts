import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent-engine/edge/llm/run-model-call", () => ({
  runModelCall: vi.fn(),
}));

import { runModelCall } from "@/lib/agent-engine/edge/llm/run-model-call";

import { analisarExtratoComIa, FRASE_SALDO_NAO_FECHOU_CONFERIR } from "./analisar";
import {
  criarExtratorComModelo,
  precisaExtracaoPorIa,
  SYSTEM_EXTRACAO_LANCAMENTOS,
  type ExtratorDeLancamentos,
} from "./extrair-ia";
import { lerLancamentos, lotesDePaginas } from "./lancamentos";
import { conferirSaldo } from "./saldo";
import {
  EXTRATO_NUBANK_SINTETICO,
  EXTRATO_STONE_MULTILINHA,
} from "./texto-sintetico";
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

function extratoNubankLongo(paginas: number): string {
  const blocos = ["Nu Pagamentos S.A.\nextrato da conta"];
  for (let i = 1; i <= paginas; i++) {
    const n = String(i).padStart(2, "0");
    blocos.push(
      `Página ${i} de ${paginas}\nLANC-P${n}\ndata 05/08/2026\ntipo credito\ncontraparte EMPRESA FOLHA P${i}\nvalor ${100 + i},00\nsaldo ${100 + i},00`,
    );
  }
  return blocos.join("\n\n");
}

function lancamentosDoConteudo(content: string): Record<string, unknown>[] {
  const saida: Record<string, unknown>[] = [];
  for (const m of content.matchAll(/LANC-P(\d+)/g)) {
    const n = Number(m[1]);
    saida.push({
      data: "05/08/2026",
      descricao: `EMPRESA FOLHA P${n}`,
      valor: 100 + n,
      direcao: "C",
      saldo: 100 + n,
    });
  }
  return saida;
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

  it("IA que lança mantém o leitor automático e pede conferência", async () => {
    const extrator: ExtratorDeLancamentos = vi.fn(async () => {
      throw new Error("extrator_json");
    });
    const r = await analisarExtratoComIa(
      `
Extrato
05/08/2026 PIX RECEBIDO EMPRESA A 1.000,00 C 1.000,00
20/08/2026 PIX RECEBIDO EMPRESA A 1.000,00 C 9.000,00
`.trim(),
      { nomeArquivo: "extrato-banco-x.pdf", extrator },
    );
    expect(r.fonteExtracao).toBe("parser");
    expect(r.lancamentos).toBe(2);
    expect(r.avisos.join(" ")).toContain(FRASE_SALDO_NAO_FECHOU_CONFERIR);
  });

  it("Stone multilinha fecha no parser e não chama a IA", async () => {
    const leitura = lerLancamentos(EXTRATO_STONE_MULTILINHA);
    expect(leitura.conferencia.fecha).toBe(true);
    expect(
      precisaExtracaoPorIa({
        layout: leitura.layout,
        lancamentos: leitura.lancamentos.length,
        paginasFaltando: leitura.paginasFaltando,
        saldoFecha: leitura.conferencia.fecha,
        escaneado: false,
        pareceExtrato: leitura.pareceExtrato,
      }),
    ).toBe(false);
    const extrator: ExtratorDeLancamentos = vi.fn(async () => {
      throw new Error("ia_nao_deveria_rodar");
    });
    const r = await analisarExtratoComIa(EXTRATO_STONE_MULTILINHA, {
      nomeArquivo: "extrato-stone.pdf",
      extrator,
    });
    expect(extrator).not.toHaveBeenCalled();
    expect(r.fonteExtracao).toBe("parser");
    expect(r.lancamentos).toBe(4);
  });
});

describe("extrator por modelo: corte, cobertura e layout alheio", () => {
  const call = vi.mocked(runModelCall);

  function extrator(tetos: { maxLotes?: number; paginasPorLote?: number; paralelo?: number } = {}) {
    return criarExtratorComModelo(
      {} as never,
      {} as never,
      { tenantId: "org", contactId: "contato" },
      {},
      tetos,
    );
  }

  it("pede JSON compacto e desliga o raciocínio da chamada", () => {
    expect(SYSTEM_EXTRACAO_LANCAMENTOS).toMatch(/JSON compacto/);
    expect(SYSTEM_EXTRACAO_LANCAMENTOS).toMatch(/numa linha/);
  });

  it("resposta cortada vira pendência de lote, sem derrubar", async () => {
    call.mockReset();
    call.mockResolvedValue({
      result: { text: '{"lancamentos":[{"data":"05/08/2026"', finishReason: "length" },
      callId: "c1",
    } as never);
    const r = await extrator()({ texto: EXTRATO_NUBANK_SINTETICO, nomeArquivo: "nubank.pdf" });
    const saida = Array.isArray(r) ? { lancamentos: r, pendencias: [] } : r;
    expect(saida.lancamentos).toEqual([]);
    expect(saida.pendencias.join(" ")).toMatch(/lote .+ não lido/);
  });

  it("JSON inválido no lote vira pendência e não lança", async () => {
    call.mockReset();
    call.mockResolvedValue({
      result: { text: "não é json", finishReason: "stop" },
      callId: "c2",
    } as never);
    const r = await extrator()({ texto: EXTRATO_NUBANK_SINTETICO });
    const saida = Array.isArray(r) ? { lancamentos: r, pendencias: [] } : r;
    expect(saida.pendencias.join(" ")).toMatch(/lote .+ não lido/);
  });

  it("layout estilo Nubank, parser falha, IA simulada lê os lançamentos", async () => {
    const leitura = lerLancamentos(EXTRATO_NUBANK_SINTETICO, { nomeArquivo: "extrato-nubank.pdf" });
    expect(leitura.lancamentos).toHaveLength(0);
    call.mockReset();
    call.mockImplementation((async (_db: unknown, _cfg: unknown, input: { messages: { content: string }[] }) => {
      const content = String(input.messages[0]?.content ?? "");
      return {
        result: {
          text: JSON.stringify({ lancamentos: lancamentosDoConteudo(content) }),
          finishReason: "stop",
        },
        callId: "nubank",
      };
    }) as never);
    const r = await analisarExtratoComIa(EXTRATO_NUBANK_SINTETICO, {
      nomeArquivo: "extrato-nubank.pdf",
      extrator: extrator(),
    });
    expect(call).toHaveBeenCalled();
    expect(call.mock.calls[0]?.[2]).toMatchObject({
      maxOutputTokens: 16_384,
      reasoning: "none",
    });
    expect(r.fonteExtracao).toBe("ia");
    expect(r.lancamentos).toBe(2);
    expect(r.itens[0]?.direcao).toBe("C");
  });

  it("mais de 6 lotes com teto de cobertura gera pendência explícita", async () => {
    const texto = extratoNubankLongo(42);
    expect(lotesDePaginas(texto, { paginasPorLote: 3 }).length).toBeGreaterThan(6);
    call.mockReset();
    call.mockImplementation((async (_db: unknown, _cfg: unknown, input: { messages: { content: string }[] }) => {
      const content = String(input.messages[0]?.content ?? "");
      return {
        result: {
          text: JSON.stringify({ lancamentos: lancamentosDoConteudo(content) }),
          finishReason: "stop",
        },
        callId: "cap",
      };
    }) as never);
    const r = await extrator({ maxLotes: 6, paginasPorLote: 3 })({ texto });
    const saida = Array.isArray(r) ? { lancamentos: r, pendencias: [] } : r;
    expect(saida.pendencias.join(" ")).toMatch(/teto de cobertura/);
    expect(saida.lancamentos.length).toBeGreaterThan(0);
    expect(saida.lancamentos.length).toBeLessThan(42);
  });

  it("extrato de 42 páginas cobre todas as páginas, sem teto", async () => {
    const texto = extratoNubankLongo(42);
    call.mockReset();
    const vistos = new Set<number>();
    call.mockImplementation((async (_db: unknown, _cfg: unknown, input: { messages: { content: string }[] }) => {
      const content = String(input.messages[0]?.content ?? "");
      for (const m of content.matchAll(/LANC-P(\d+)/g)) vistos.add(Number(m[1]));
      return {
        result: {
          text: JSON.stringify({ lancamentos: lancamentosDoConteudo(content) }),
          finishReason: "stop",
        },
        callId: "full",
      };
    }) as never);
    const r = await analisarExtratoComIa(texto, {
      nomeArquivo: "extrato-nubank-42.pdf",
      extrator: extrator({ paginasPorLote: 3 }),
    });
    expect(vistos.size).toBe(42);
    expect(r.fonteExtracao).toBe("ia");
    expect(r.lancamentos).toBe(42);
    expect(r.avisos.join(" ")).not.toMatch(/teto de cobertura/);
  });

  it("corte com lote partível tenta as duas metades uma vez", async () => {
    const texto = extratoNubankLongo(4);
    call.mockReset();
    call.mockImplementation((async (_db: unknown, _cfg: unknown, input: { messages: { content: string }[] }) => {
      const content = String(input.messages[0]?.content ?? "");
      const paginasNoLote = [...content.matchAll(/Página \d+ de /g)].length;
      if (paginasNoLote >= 3) {
        return {
          result: { text: '{"lancamentos":[', finishReason: "length" },
          callId: "cut",
        };
      }
      return {
        result: {
          text: JSON.stringify({ lancamentos: lancamentosDoConteudo(content) }),
          finishReason: "stop",
        },
        callId: "ok",
      };
    }) as never);
    const r = await extrator({ paginasPorLote: 3 })({ texto });
    const saida = Array.isArray(r) ? { lancamentos: r, pendencias: [] } : r;
    expect(saida.lancamentos.length).toBe(4);
    expect(call.mock.calls.length).toBeGreaterThan(1);
  });
});
