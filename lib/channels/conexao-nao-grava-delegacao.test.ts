import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("conexão de canal não classifica delegação", () => {
  it("o módulo de conectar sessão não grava vínculo empresarial", () => {
    const src = readFileSync("lib/channels/connect-waha.ts", "utf8");
    expect(src).not.toMatch(/delegacao_sessoes_empresariais|vincularSessaoContaEmpresarial/);
  });
});
