/**
 * 0774 — o e2e supabase (SHA 3d4f2ca89d) abortou o baseline: dono do schema
 * = supabase_admin, postgres NOSUPERUSER sem membership, GRANT do dono a si
 * → 42501. Aqui o dono NÃO é membro do aplicador; um papel com USAGE
 * GRANT OPTION é. O DO da 0774 (texto do arquivo) SET ROLE nesse papel,
 * grava USAGE+SELECT, não aborta, sem escrita.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./psql-transporte";

const SUFIXO = `${process.pid}`;
const ADMIN = `deleg_e2e_admin_${SUFIXO}`;
const GRANTER = `deleg_e2e_granter_${SUFIXO}`;
const APPLIER = `deleg_e2e_applier_${SUFIXO}`;
const SCHEMA = `deleg_e2e_probe_${SUFIXO}`;

function flag(q: string): boolean {
  return lastLine(sql(q)) === "t";
}

function do0774StorageGrant(schema: string): string {
  const src = readFileSync(
    resolve("supabase/migrations/20261108210000_0774_delegacao_papel_dedicado.sql"),
    "utf8",
  );
  const marker = "if not has_schema_privilege('oauth_delegado', 'storage', 'usage')";
  const gate = src.lastIndexOf(marker);
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
    drop role if exists ${GRANTER};
    drop role if exists ${ADMIN};
  `);
});

describe("0774 — dono supabase_admin sem membership; GRANT OPTION em outro papel", () => {
  it("prepara dono ≠ aplicador, granter com USAGE grantable", () => {
    sql(`
      reset role;
      drop schema if exists ${SCHEMA} cascade;
      drop role if exists ${APPLIER};
      drop role if exists ${GRANTER};
      drop role if exists ${ADMIN};
      do $papel$
      begin
        if not exists (select 1 from pg_roles where rolname = 'oauth_delegado') then
          create role oauth_delegado nologin noinherit;
        end if;
      end
      $papel$;
      create role ${ADMIN} nologin nosuperuser;
      create role ${GRANTER} nologin nosuperuser noinherit;
      create role ${APPLIER} nologin nosuperuser noinherit;
      grant ${ADMIN} to current_user;
      grant ${GRANTER} to current_user;
      grant ${APPLIER} to current_user;
      grant ${GRANTER} to ${APPLIER};
      create schema ${SCHEMA} authorization ${ADMIN};
      set role ${ADMIN};
      create table ${SCHEMA}.objects (id int primary key);
      alter table ${SCHEMA}.objects enable row level security;
      create policy ${SCHEMA}_sel on ${SCHEMA}.objects for select using (true);
      grant usage on schema ${SCHEMA} to ${APPLIER};
      grant usage on schema ${SCHEMA} to ${GRANTER} with grant option;
      reset role;
      alter table ${SCHEMA}.objects owner to ${GRANTER};
      set role ${GRANTER};
      grant select on ${SCHEMA}.objects to ${APPLIER} with grant option;
      reset role;
    `);
    expect(flag(`select pg_has_role('${APPLIER}', '${ADMIN}', 'member');`)).toBe(false);
    expect(flag(`select pg_has_role('${APPLIER}', '${GRANTER}', 'member');`)).toBe(true);
    expect(flag(`select has_schema_privilege('oauth_delegado', '${SCHEMA}', 'usage');`)).toBe(
      false,
    );
    expect(
      flag(`select has_table_privilege('oauth_delegado', '${SCHEMA}.objects', 'select');`),
    ).toBe(false);
  });

  it("DO da 0774 como aplicador: USAGE+SELECT; apply não aborta; sem escrita", () => {
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
      flag(`select has_table_privilege('oauth_delegado', '${SCHEMA}.objects', 'truncate');`),
    ).toBe(false);
  });
});
