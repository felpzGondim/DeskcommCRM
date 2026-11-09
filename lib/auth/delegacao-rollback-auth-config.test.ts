import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PROC = readFileSync("supabase/rollback/0774_auth_config.md", "utf8");
const SQL = readFileSync("supabase/rollback/0774_delegacao_papel_dedicado.sql", "utf8");
const DECISAO = readFileSync("docs/decisoes/delegacao-papel-dedicado.md", "utf8");

describe("rollback 0774 — config Auth externa ao catálogo", () => {
  it("procedimento existe e não trata imagem como restore de DB", () => {
    expect(PROC).toMatch(/GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED/);
    expect(PROC).toMatch(/não leia, não imprima, não grave em log/i);
    expect(PROC).toMatch(/Recarregue \*\*só o processo Auth\*\*/);
    expect(PROC).toMatch(/`agent\.sh` \*\*não\*\* é restore/);
    expect(SQL).toMatch(/0774_auth_config\.md/);
    expect(SQL).toMatch(/NÃO desliga RLS em storage\.objects/);
    expect(DECISAO).toMatch(/access JWT permanece válido até `exp`/);
    expect(DECISAO).toMatch(/Não inventar logout que mate o access token/);
    expect(DECISAO).toMatch(/três inventários independentes/);
    expect(PROC).toMatch(/três inventários independentes/);
    expect(PROC).toMatch(/Grant CRM `revoked_at`/);
    expect(PROC).not.toMatch(/logout mata o access/i);
  });
});
