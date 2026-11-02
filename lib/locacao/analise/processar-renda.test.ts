import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MOTIVOS_RENDA } from "@/lib/locacao/analise/motivos-renda";

describe("worker da análise de renda", () => {
  it("lê o extrato sem teto, grava motivo e não importa o Hub", () => {
    const src = readFileSync("lib/locacao/analise/processar-renda.ts", "utf8");
    expect(src).toContain("semTetoPaginas: true");
    expect(src).toContain("semTetoTexto: true");
    expect(src).toContain("avaliarRegra3x");
    expect(src).toContain("onProgresso");
    expect(src).toContain("imagem_sem_leitura");
    expect(src).not.toMatch(/servidor-externo|chamarFerramentaRemota|carregarServidorMcpExterno/);
    expect(src).not.toMatch(/catch\s*\(\s*\)\s*\{\s*\}/);
    expect(src).toContain("criarLeitorPacoteViaHub");
    expect(src).toContain(MOTIVOS_RENDA.timeout);
  });

  it("a rota do cron drena a fila e só audita com efeito", () => {
    const cron = readFileSync("app/api/v1/cron/locacao-execucoes/route.ts", "utf8");
    expect(cron).toContain("processarAnaliseDeRenda");
    expect(cron).toContain("idsDeOrgsParadas");
    expect(cron).toContain("if (efeito > 0)");
    expect(cron).toContain("MOTIVOS_RENDA.timeout");
    expect(cron).not.toMatch(/\.eq\(["']status["'],\s*["']active["']\)/);
    expect(cron).not.toMatch(/servidor-externo/);
  });

  it("a leitura em blocos não corta no 30", () => {
    const leitura = readFileSync("lib/agent-engine/agent/painel-leitura-anexos.ts", "utf8");
    expect(leitura).toContain("semTetoPaginas");
    expect(leitura).toContain("textoDoProgressoDeExtrato");
    expect(leitura).toContain("motivo_anexo");
    expect(leitura).not.toMatch(/catch\s*\(\s*\)\s*\{\s*\}/);
    const pdf = readFileSync("lib/ai/rag/extractors/pdf-paginas.ts", "utf8");
    expect(pdf).toContain("paginaInicial");
    expect(pdf).toContain("paginaFinal");
    expect(pdf).toContain("export async function contarPaginasPdf");
  });
});
