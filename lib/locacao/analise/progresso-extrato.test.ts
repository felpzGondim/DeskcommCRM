import { describe, expect, it } from "vitest";

import {
  lerExtratoEmBlocos,
  textoDoProgressoDeExtrato,
} from "@/lib/locacao/analise/progresso-extrato";

describe("progresso da leitura do extrato", () => {
  it("a frase é 'lendo extrato pág. X de N'", () => {
    expect(textoDoProgressoDeExtrato(12, 43)).toBe("lendo extrato pág. 12 de 43");
    expect(textoDoProgressoDeExtrato(1, 1)).toBe("lendo extrato pág. 1 de 1");
  });

  it("lê extrato fictício de mais de 30 páginas, sem cortar no 30", async () => {
    const paginas = Array.from({ length: 43 }, (_, i) => ({
      pagina: i + 1,
      texto: `Página ${i + 1} — CREDITO SALARIO ACME C 1.000,00`,
    }));
    const etapas: string[] = [];
    const { texto, progressos } = await lerExtratoEmBlocos(paginas, 5, (p) => {
      etapas.push(p.etapa);
    });
    expect(paginas.length).toBeGreaterThan(30);
    expect(progressos).toContain("lendo extrato pág. 5 de 43");
    expect(progressos).toContain("lendo extrato pág. 10 de 43");
    expect(progressos).toContain("lendo extrato pág. 30 de 43");
    expect(progressos).toContain("lendo extrato pág. 40 de 43");
    expect(progressos).toContain("lendo extrato pág. 43 de 43");
    expect(etapas.at(-1)).toBe("lendo extrato pág. 43 de 43");
    expect(texto).toContain("Página 1");
    expect(texto).toContain("Página 31");
    expect(texto).toContain("Página 43");
    expect(texto).not.toMatch(/teto|limite de 30/i);
  });
});
