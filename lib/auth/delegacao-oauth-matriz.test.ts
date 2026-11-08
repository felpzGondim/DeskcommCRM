import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  ACESSO_HERDADO_AGORA_NEGADO,
  ACESSO_HERDADO_AINDA_ABERTO,
  ACESSO_NOVO_DESTA_MIGRATION,
  POLITICA_DEFAULT_DENY_OAUTH,
  RPC_OAUTH,
  STORAGE_OAUTH,
  TABELAS_OAUTH_LEITURA_COM_GRANT,
} from "./delegacao-oauth-matriz";

const RAIZ = path.join(__dirname, "..", "..");
const MIGRATION = path.join(
  RAIZ,
  "supabase/migrations/20261108190000_0773_delegacao_visibilidade_corporativa.sql",
);

describe("matriz OAuth — allow/deny fail-closed (offline)", () => {
  const sql = fs.readFileSync(MIGRATION, "utf8");

  it("allowlist de leitura casa com a exclusion do laço default-deny", () => {
    expect(TABELAS_OAUTH_LEITURA_COM_GRANT).toEqual([
      "delegacao_visibilidade_corporativa",
      "conversations",
      "messages",
      "contacts",
      "channel_sessions",
    ]);
    for (const t of TABELAS_OAUTH_LEITURA_COM_GRANT) {
      expect(sql).toMatch(new RegExp(`'${t}'`));
    }
    expect(sql).toMatch(/relname not in/i);
    expect(sql).toMatch(/p\.polpermissive/);
    expect(sql).toMatch(new RegExp(`create policy ${POLITICA_DEFAULT_DENY_OAUTH} on`, "i"));
    expect(sql).not.toMatch(
      /create policy oauth_cookie_only on %I\.%I as restrictive for all to authenticated/,
    );
  });

  it("contacts e channel_sessions têm SELECT grant-aware, não cookie-only FOR ALL", () => {
    expect(sql).toMatch(/oauth_delegacao_select on public\.contacts/);
    expect(sql).toMatch(/oauth_delegacao_select on public\.channel_sessions/);
    expect(sql).toMatch(/is_personal is false/);
    expect(sql).toMatch(/classificacao_empresarial = 'corporativa'/);
    expect(sql).toMatch(/oauth_cookie_only_delete on public\.contacts/);
    expect(sql).toMatch(/oauth_cookie_only_delete on public\.channel_sessions/);
  });

  it("Storage default-deny; locacao não está na allowlist (entra no laço)", () => {
    expect(STORAGE_OAUTH).toBe("default_deny");
    expect(sql).toMatch(/oauth_cookie_only on storage\.objects/);
    const allow = sql.slice(sql.indexOf("relname not in"), sql.indexOf("loop"));
    expect(allow).not.toMatch(/locacao_processo_documentos/);
  });

  it("0773 não concede EXECUTE novo; RPC permanece não confinada", () => {
    const codigo = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(codigo).not.toMatch(/grant execute/i);
    expect(RPC_OAUTH.estado).toBe("nao_confinado");
    expect(RPC_OAUTH.decisao_fora_de_escopo).toMatch(/Felipe/);
    expect(ACESSO_HERDADO_AINDA_ABERTO.some((s) => s.includes("SECURITY DEFINER"))).toBe(true);
    expect(ACESSO_NOVO_DESTA_MIGRATION.length).toBeGreaterThan(0);
    expect(ACESSO_HERDADO_AGORA_NEGADO.some((s) => s.includes("locacao_"))).toBe(true);
  });

  it("sem função nova e sem SECURITY DEFINER no SQL executável", () => {
    const codigo = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(codigo).not.toMatch(/create (or replace )?function/i);
    expect(codigo).not.toMatch(/security definer/i);
  });
});
