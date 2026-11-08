/**
 * Reversão ensaiada da 0774: snapshot de CATÁLOGOS (policies/ACL/papel/RLS/hook),
 * não dump de conversa/storage. 0774 não escreve dado de atendimento.
 * Equivalência: estado pós-baseline == rollback + reaplicar a migration.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { lastLine, sql } from "./psql-transporte";

const SNAPSHOT = readFileSync("supabase/rollback/0774_snapshot_catalogo.sql", "utf8");
const ROLLBACK = readFileSync("supabase/rollback/0774_delegacao_papel_dedicado.sql", "utf8");
const MIGRACAO = readFileSync(
  "supabase/migrations/20261108210000_0774_delegacao_papel_dedicado.sql",
  "utf8",
);

function catalogo(): unknown {
  return JSON.parse(lastLine(sql(SNAPSHOT))) as unknown;
}

describe("0774 rollback de catálogo (não restore indiscriminado)", () => {
  it("snapshot não seleciona linhas de conversa nem objetos de storage", () => {
    expect(SNAPSHOT).not.toMatch(/from public\.conversations/i);
    expect(SNAPSHOT).not.toMatch(/from storage\.objects/i);
    expect(SNAPSHOT).toMatch(/pg_policy/);
    expect(SNAPSHOT).toMatch(/pg_roles/);
  });

  it("rollback remove o papel; reaplicar a 0774 restaura o catálogo", () => {
    const antes = catalogo();
    try {
      sql(ROLLBACK);
      expect(
        lastLine(
          sql(`select exists (
                 select 1 from pg_auth_members m
                 join pg_roles r on r.oid = m.roleid
                 join pg_roles u on u.oid = m.member
                where r.rolname = 'oauth_delegado' and u.rolname = 'authenticator'
               );`),
        ),
      ).toBe("f");
      expect(
        lastLine(
          sql(`select count(*) from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public'
                 and c.relname = 'delegacao_contas_empresariais';`),
        ),
      ).toBe("0");
      sql(MIGRACAO);
      const depois = catalogo();
      expect(depois).toEqual(antes);
    } finally {
      // Membership de role é no cluster: devolver mesmo se a asserção falhar,
      // senão o próximo arquivo do harness herda authenticator sem SET ROLE.
      sql(`
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = 'oauth_delegado')
             and exists (select 1 from pg_roles where rolname = 'authenticator') then
            execute 'grant oauth_delegado to authenticator';
          end if;
        end
        $$;
      `);
    }
  });
});
