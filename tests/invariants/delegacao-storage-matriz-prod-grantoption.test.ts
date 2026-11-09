/**
 * Matriz do CRM gerenciado (pré-flight SELECT administrativo, sem mutação):
 * session/current = postgres NOSUPERUSER INHERIT LOGIN; dono schema storage
 * = supabase_admin; objects/buckets = supabase_storage_admin; postgres NÃO é
 * membro dos owners; USAGE no schema COM GRANT OPTION (grantor admin);
 * SELECT em objects/buckets COM GRANT OPTION (grantor storage_admin);
 * objects RLS ON, FORCE RLS OFF. oauth_delegado ainda não existe no CRM
 * vivo — o teste cria o papel como a 0774 fará.
 *
 * O conector administrativo existente concede o mínimo via GRANT OPTION,
 * sem owner, sem superuser, sem SET ROLE, sem credencial nova.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./psql-transporte";

const SUFIXO = `${process.pid}`;
const ADMIN = `prod_admin_${SUFIXO}`;
const STOR = `prod_stor_${SUFIXO}`;
const PG = `prod_pg_${SUFIXO}`;
const SCHEMA = `prod_storage_${SUFIXO}`;

function flag(q: string): boolean {
  return lastLine(sql(q)) === "t";
}

function ativarSql(schema: string): string {
  return readFileSync(resolve("supabase/delegacao-storage-ativar.sql"), "utf8")
    .replaceAll("storage.objects", `${schema}.objects`)
    .replaceAll("storage.buckets", `${schema}.buckets`)
    .replaceAll("schema storage", `schema ${schema}`)
    .replaceAll("'storage'", `'${schema}'`);
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
  return src
    .slice(from, to + 3)
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

describe("matriz CRM gerenciado — GRANT OPTION no postgres existente", () => {
  it("monta a matriz: sem membership, USAGE/SELECT com GRANT OPTION, RLS ON force OFF", () => {
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
      create role ${PG} login nosuperuser inherit;
      grant ${ADMIN} to current_user;
      grant ${STOR} to current_user;
      grant ${PG} to current_user;
      create schema ${SCHEMA} authorization ${ADMIN};
      set role ${ADMIN};
      grant usage on schema ${SCHEMA} to ${STOR};
      grant usage on schema ${SCHEMA} to ${PG} with grant option;
      create table ${SCHEMA}.objects (id int primary key);
      alter table ${SCHEMA}.objects enable row level security;
      create policy ${SCHEMA}_sel on ${SCHEMA}.objects for select using (true);
      create table ${SCHEMA}.buckets (id int primary key);
      reset role;
      alter table ${SCHEMA}.objects owner to ${STOR};
      alter table ${SCHEMA}.buckets owner to ${STOR};
      set role ${STOR};
      grant select on ${SCHEMA}.objects to ${PG} with grant option;
      grant select on ${SCHEMA}.buckets to ${PG} with grant option;
      reset role;
    `);
    expect(flag(`select pg_has_role('${PG}', '${ADMIN}', 'member');`)).toBe(false);
    expect(flag(`select pg_has_role('${PG}', '${STOR}', 'member');`)).toBe(false);
    expect(
      lastLine(sql(`select rolsuper::text from pg_roles where rolname='${PG}';`)),
    ).toBe("false");
    expect(
      lastLine(sql(`select rolinherit::text from pg_roles where rolname='${PG}';`)),
    ).toBe("true");
    expect(
      lastLine(sql(`select rolcanlogin::text from pg_roles where rolname='${PG}';`)),
    ).toBe("true");
    expect(
      lastLine(
        sql(`
          select a.is_grantable::text
            from pg_namespace n
            cross join lateral aclexplode(n.nspacl) a
            join pg_roles r on r.oid = a.grantee
           where n.nspname = '${SCHEMA}'
             and r.rolname = '${PG}'
             and a.privilege_type = 'USAGE';
        `),
      ),
    ).toBe("true");
    expect(
      lastLine(
        sql(`
          select a.is_grantable::text
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            cross join lateral aclexplode(c.relacl) a
            join pg_roles r on r.oid = a.grantee
           where n.nspname = '${SCHEMA}' and c.relname = 'objects'
             and r.rolname = '${PG}'
             and a.privilege_type = 'SELECT';
        `),
      ),
    ).toBe("true");
    expect(
      lastLine(
        sql(`
          select c.relrowsecurity::text || ',' || c.relforcerowsecurity::text
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = '${SCHEMA}' and c.relname = 'objects';
        `),
      ),
    ).toBe("true,false");
    expect(flag(`select has_schema_privilege('oauth_delegado', '${SCHEMA}', 'usage');`)).toBe(
      false,
    );
  });

  it("ativar.sql como postgres (GRANT OPTION) concede USAGE+SELECT; sem escrita; sem SET ROLE", () => {
    expect(ativarSql(SCHEMA)).not.toMatch(/^\s*set role/im);
    sql(`
      set role ${PG};
      ${ativarSql(SCHEMA)}
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

  it("0774 como o mesmo postgres também grava (rollout, não inerte)", () => {
    sql(`
      set role ${PG};
      revoke usage on schema ${SCHEMA} from oauth_delegado;
      revoke select on ${SCHEMA}.objects from oauth_delegado;
      revoke select on ${SCHEMA}.buckets from oauth_delegado;
      reset role;
    `);
    expect(flag(`select has_schema_privilege('oauth_delegado', '${SCHEMA}', 'usage');`)).toBe(
      false,
    );
    sql(`
      set role ${PG};
      ${do0774(SCHEMA)}
      reset role;
    `);
    expect(flag(`select has_schema_privilege('oauth_delegado', '${SCHEMA}', 'usage');`)).toBe(
      true,
    );
    expect(
      flag(`select has_table_privilege('oauth_delegado', '${SCHEMA}.objects', 'select');`),
    ).toBe(true);
  });
});
