/**
 * Matriz do stack e2e (supabase/postgres:15.8.1.085, CLI 2.117.0):
 * session/current = postgres NOSUPERUSER INHERIT; schema storage dono
 * supabase_admin; objects dono supabase_storage_admin RLS ON; nspacl USAGE
 * grant_option=false para postgres e storage_admin; postgres NÃO é membro
 * de supabase_admin nem de supabase_storage_admin.
 *
 * Apply 0774 como postgres: USAGE/SELECT continuam false (inerte).
 * Ativação: GRANT como o dono do schema — USAGE+SELECT, sem escrita.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { lastLine, motivoDoErro, sql } from "./psql-transporte";

const SUFIXO = `${process.pid}`;
const ADMIN = `ci_admin_${SUFIXO}`;
const STOR = `ci_stor_${SUFIXO}`;
const PG = `ci_pg_${SUFIXO}`;
const SCHEMA = `ci_storage_${SUFIXO}`;

function flag(q: string): boolean {
  return lastLine(sql(q)) === "t";
}

function do0774(schema: string): string {
  const src = readFileSync(
    resolve("supabase/migrations/20261108210000_0774_delegacao_papel_dedicado.sql"),
    "utf8",
  );
  const marker = "if not has_schema_privilege('oauth_delegado', 'storage', 'usage')";
  const gate = src.lastIndexOf(marker);
  if (gate < 0) throw new Error("0774 DO ausente");
  const from = src.lastIndexOf("do $$", gate);
  const to = src.indexOf("$$;", gate);
  let block = src.slice(from, to + 3);
  return block
    .replaceAll("storage.objects", `${schema}.objects`)
    .replaceAll("storage.buckets", `${schema}.buckets`)
    .replaceAll("schema storage", `schema ${schema}`)
    .replaceAll("'storage'", `'${schema}'`);
}

afterAll(() => {
  sql(`
    reset role;
    drop schema if exists ${SCHEMA} cascade;
    drop role if exists ${PG};
    drop role if exists ${STOR};
    drop role if exists ${ADMIN};
  `);
});

describe("matriz CI supabase/postgres:15.8.1.085 — apply inerte vs ativação dono", () => {
  it("monta a matriz: postgres sem membership, USAGE sem GRANT OPTION", () => {
    sql(`
      reset role;
      drop schema if exists ${SCHEMA} cascade;
      drop role if exists ${PG};
      drop role if exists ${STOR};
      drop role if exists ${ADMIN};
      do $papel$
      begin
        if not exists (select 1 from pg_roles where rolname = 'oauth_delegado') then
          create role oauth_delegado nologin noinherit;
        end if;
      end
      $papel$;
      create role ${ADMIN} nologin superuser;
      create role ${STOR} nologin nosuperuser noinherit createrole;
      create role ${PG} nologin nosuperuser inherit createrole createdb bypassrls;
      grant ${ADMIN} to current_user;
      grant ${STOR} to current_user;
      grant ${PG} to current_user;
      create schema ${SCHEMA} authorization ${ADMIN};
      grant usage on schema ${SCHEMA} to ${PG};
      grant all on schema ${SCHEMA} to ${STOR};
      set role ${ADMIN};
      create table ${SCHEMA}.objects (id int primary key);
      alter table ${SCHEMA}.objects enable row level security;
      create policy ${SCHEMA}_sel on ${SCHEMA}.objects for select using (true);
      create table ${SCHEMA}.buckets (id int primary key);
      reset role;
      alter table ${SCHEMA}.objects owner to ${STOR};
      alter table ${SCHEMA}.buckets owner to ${STOR};
      set role ${STOR};
      grant all on ${SCHEMA}.objects to ${PG};
      grant all on ${SCHEMA}.buckets to ${PG};
      reset role;
    `);
    expect(flag(`select pg_has_role('${PG}', '${ADMIN}', 'member');`)).toBe(false);
    expect(flag(`select pg_has_role('${PG}', '${STOR}', 'member');`)).toBe(false);
    expect(
      flag(
        `select not exists (select 1 from pg_roles where rolname = 'supabase_admin')
            or not pg_has_role('${PG}', 'supabase_admin', 'member');`,
      ),
    ).toBe(true);
    expect(
      flag(
        `select not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin')
            or not pg_has_role('${PG}', 'supabase_storage_admin', 'member');`,
      ),
    ).toBe(true);
    expect(
      lastLine(sql(`select rolsuper::text from pg_roles where rolname='${PG}';`)),
    ).toBe("false");
    expect(flag(`select has_schema_privilege('oauth_delegado', '${SCHEMA}', 'usage');`)).toBe(
      false,
    );
  });

  it("DO 0774 como postgres da matriz: USAGE e SELECT continuam false", () => {
    sql(`
      set role ${PG};
      ${do0774(SCHEMA)}
      reset role;
    `);
    expect(flag(`select has_schema_privilege('oauth_delegado', '${SCHEMA}', 'usage');`)).toBe(
      false,
    );
    expect(
      flag(`select has_table_privilege('oauth_delegado', '${SCHEMA}.objects', 'select');`),
    ).toBe(false);
  });

  it("ativar.sql como postgres da matriz aborta (não mascara)", () => {
    let recusou = false;
    let motivo = "";
    try {
      sql(`
        set role ${PG};
        grant usage on schema ${SCHEMA} to oauth_delegado;
        do $a$
        begin
          if not has_schema_privilege('oauth_delegado', '${SCHEMA}', 'usage') then
            raise exception
              'delegacao: ativação storage recusada (aplicador=%, precisa supabase_admin)'
              , current_user
              using errcode = '42501';
          end if;
        end
        $a$;
      `);
    } catch (err) {
      motivo = motivoDoErro(err);
      recusou = /ativação storage recusada/i.test(motivo);
    }
    sql(`reset role;`);
    expect(recusou, motivo.slice(0, 400)).toBe(true);
  });

  it("ativação como dono do schema: USAGE+SELECT; sem escrita", () => {
    sql(`
      set role ${ADMIN};
      grant usage on schema ${SCHEMA} to oauth_delegado;
      grant select on ${SCHEMA}.objects to oauth_delegado;
      grant select on ${SCHEMA}.buckets to oauth_delegado;
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
