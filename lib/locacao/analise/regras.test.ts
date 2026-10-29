import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A classificação por regex deste arquivo foi aposentada: a renda comprovada
 * sai de `lib/locacao/extrato` (regra do Felipe no #31). PIX/TED de terceiros
 * entram; o regex antigo os excluía.
 */
describe("regras.ts aposentada", () => {
  it("renda.ts e analise.ts não importam a classificação por regex", () => {
    const renda = readFileSync("lib/locacao/analise/renda.ts", "utf8");
    const analise = readFileSync("lib/painel/acoes/analise.ts", "utf8");
    expect(renda).not.toMatch(/analise\/regras/);
    expect(analise).not.toMatch(/analise\/regras/);
    expect(renda).toContain("lib/locacao/extrato");
    expect(analise).toContain("prepararFontesDoRelatorio");
  });
});
