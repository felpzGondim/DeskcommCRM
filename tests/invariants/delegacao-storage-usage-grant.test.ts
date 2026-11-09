/**
 * 0774 — GRANT USAGE no schema de storage quando o dono ≠ aplicador.
 *
 * Medido em Postgres 15 (WARNING, não 42501): aplicador NOSUPERUSER NOINHERIT,
 * membro do dono, com USAGE sem GRANT OPTION, concede SELECT (tem GRANT OPTION)
 * e o GRANT USAGE "sucede" sem gravar. É o e2e e1973dc9ae (obj_sel true,
 * stor_usage false). O DO da 0774 (texto do arquivo, nomes da sonda) SET ROLE
 * no dono e grava USAGE+SELECT — sem INSERT/UPDATE/DELETE/TRUNCATE.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./psql-transporte";

const SUFIXO = `${process.pid}`;
const OWNER = `deleg_usage_owner_${SUFIXO}`;
const APPLIER = `deleg_usage_applier_${SUFIXO}`;
const SCHEMA = `deleg_usage_probe_${SUFIXO}`;

function flag(q: string): boolean {
  return lastLine(sql(q)) === "t";
}

function do0774StorageGrant(schema: string): string {
  const src = readFileSync(
    resolve("supabase/migrations/20261108210000_0774_delegacao_papel_dedicado.sql"),
    "utf8",
  );
  const marker = "if not has_schema_privilege('oauth_delegado', 'storage', 'usage')";
  const gate = src.indexOf(marker);
  if (gate < 0) throw new Error("0774: gate has_schema_privilege storage ausente");
  const from = src.lastIndexOf("do $$", gate);
  const to = src.indexOf("$$;", gate);
  if (from < 0 || to < 0) throw new Error("0774: DO do GRANT storage ausente");
  let block = src.slice(from, to + 3);
  if (schema !== "storage") {
    block = block
      .replaceAll("storage.objects", `${schema}.objects`)
      .replaceAll("storage.buckets", `${schema}.buckets`)
      .replaceAll("schema storage", `schema ${schema}`)
      .replaceAll("'storage'", `'${schema}'`);
  }
  return block;
}

afterAll(() => {
  sql(`
    reset role;
    drop schema if exists ${SCHEMA} cascade;
    drop role if exists ${APPLIER};
    drop role if exists ${OWNER};
  `);
});

describe("0774 — GRANT USAGE silencioso vs dono do schema", () => {
  it("prepara dono ≠ aplicador NOSUPERUSER NOINHERIT e tabela com RLS ON", () => {
    sql(`
      reset role;
      drop schema if exists ${SCHEMA} cascade;
      drop role if exists ${APPLIER};
      drop role if exists ${OWNER};
      do $papel$
      begin
        if not exists (select 1 from pg_roles where rolname = 'oauth_delegado') then
          create role oauth_delegado nologin noinherit;
        end if;
      end
      $papel$;
      create role ${OWNER} nologin nosuperuser;
      create role ${APPLIER} nologin nosuperuser noinherit;
      grant ${OWNER} to current_user;
      grant ${APPLIER} to current_user;
      grant ${OWNER} to ${APPLIER};
      create schema ${SCHEMA} authorization ${OWNER};
      set role ${OWNER};
      create table ${SCHEMA}.objects (id int primary key);
      alter table ${SCHEMA}.objects enable row level security;
      create policy ${SCHEMA}_sel on ${SCHEMA}.objects for select using (true);
      grant usage on schema ${SCHEMA} to ${APPLIER};
      grant select on ${SCHEMA}.objects to ${APPLIER} with grant option;
      reset role;
    `);
    expect(
      lastLine(
        sql(`select c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='${SCHEMA}' and c.relname='objects';`),
      ),
    ).toBe("true");
    expect(flag(`select pg_has_role('${APPLIER}', '${OWNER}', 'member');`)).toBe(true);
    expect(
      lastLine(sql(`select rolinherit::text from pg_roles where rolname='${APPLIER}';`)),
    ).toBe("false");
  });

  it("antes: oauth_delegado sem USAGE nem SELECT na sonda", () => {
    expect(flag(`select has_schema_privilege('oauth_delegado', '${SCHEMA}', 'usage');`)).toBe(
      false,
    );
    expect(
      flag(`select has_table_privilege('oauth_delegado', '${SCHEMA}.objects', 'select');`),
    ).toBe(false);
  });

  it("GRANT como aplicador: USAGE não grava (WARNING); SELECT grava", () => {
    sql(`
      set role ${APPLIER};
      grant usage on schema ${SCHEMA} to oauth_delegado;
      grant select on ${SCHEMA}.objects to oauth_delegado;
      reset role;
    `);
    expect(flag(`select has_schema_privilege('oauth_delegado', '${SCHEMA}', 'usage');`)).toBe(
      false,
    );
    expect(
      flag(`select has_table_privilege('oauth_delegado', '${SCHEMA}.objects', 'select');`),
    ).toBe(true);
    sql(`
      set role ${APPLIER};
      revoke select on ${SCHEMA}.objects from oauth_delegado;
      reset role;
    `);
    expect(
      flag(`select has_table_privilege('oauth_delegado', '${SCHEMA}.objects', 'select');`),
    ).toBe(false);
  });

  it("DO da 0774 como aplicador: USAGE+SELECT; sem escrita", () => {
    sql(`
      set role ${APPLIER};
      ${do0774StorageGrant(SCHEMA)}
      reset role;
    `);
    expect(flag(`select has_schema_privilege('oauth_delegado', '${SCHEMA}', 'usage');`)).toBe(
      true,
    );
    expect(
      flag(`select has_table_privilege('oauth_delegado', '${SCHEMA}.objects', 'select');`),
    ).toBe(true);
    expect(
      flag(`select has_table_privilege('oauth_delegado', '${SCHEMA}.objects', 'insert');`),
    ).toBe(false);
    expect(
      flag(`select has_table_privilege('oauth_delegado', '${SCHEMA}.objects', 'update');`),
    ).toBe(false);
    expect(
      flag(`select has_table_privilege('oauth_delegado', '${SCHEMA}.objects', 'delete');`),
    ).toBe(false);
    expect(
      flag(`select has_table_privilege('oauth_delegado', '${SCHEMA}.objects', 'truncate');`),
    ).toBe(false);
  });
});
