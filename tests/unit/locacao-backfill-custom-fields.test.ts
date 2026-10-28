import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O lote de 28/10/2026 gravou chaves em contacts.custom_fields. A 0765 copia
 * para contato_superlogica_vinculos e NÃO apaga essas chaves.
 */
const SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/20261028140200_0765_superlogica_vinculo_execucoes.sql"),
  "utf8",
);

describe("backfill Superlógica (0765)", () => {
  it("lê as chaves já gravadas e não as apaga", () => {
    expect(SQL).toContain("superlogica_id_pessoa");
    expect(SQL).toContain("superlogica_tipo");
    expect(SQL).toContain("superlogica_qualidade");
    expect(SQL).toContain("superlogica_vinculado_em");
    expect(SQL).toContain("casamento_telefone");
    expect(SQL).toMatch(/custom_fields \? 'superlogica_id_pessoa'/);
    expect(SQL).not.toMatch(/custom_fields\s*=/i);
    expect(SQL).not.toMatch(/custom_fields\s+-/);
    expect(SQL).not.toMatch(/update\s+public\.contacts/i);
  });
});
