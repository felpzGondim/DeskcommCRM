import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRACAO = "supabase/migrations/20261108210000_0774_delegacao_papel_dedicado.sql";
const sql = readFileSync(MIGRACAO, "utf8");
const BASELINE = readFileSync("supabase/baseline.sql", "utf8");

describe("0774 não é a 0773 experimental", () => {
  it("tem -- manifest:", () => {
    expect(sql.startsWith("-- manifest:")).toBe(true);
  });

  it("não pinta oauth_cookie_only nem FOR ALL global", () => {
    expect(sql).not.toMatch(/oauth_cookie_only/);
    expect(sql).not.toMatch(/for all\s+to authenticated/i);
    expect(sql).not.toMatch(/classificacao_empresarial/);
  });

  it("recorta SELECT da cookie TO authenticated nas tabelas concedidas ao papel", () => {
    expect(sql).toMatch(/create policy "conversations_select"[\s\S]*for select to authenticated/);
    expect(sql).toMatch(/create policy "messages_select"[\s\S]*for select to authenticated/);
  });

  it("cria papel NOINHERIT e policies TO oauth_delegado", () => {
    expect(sql).toMatch(/create role oauth_delegado nologin noinherit/);
    expect(sql).toMatch(/grant oauth_delegado to authenticator/);
    expect(sql).toMatch(/to oauth_delegado/);
    expect(sql).toMatch(/fn_delegacao_access_token_hook/);
  });

  it("o apêndice do baseline carrega o mesmo rótulo", () => {
    expect(BASELINE).toMatch(/delegação papel dedicado \(migration 0774\)/);
    const ultimo = BASELINE.lastIndexOf("fn_delegacao_access_token_hook");
    expect(ultimo).toBeGreaterThan(0);
  });
});
