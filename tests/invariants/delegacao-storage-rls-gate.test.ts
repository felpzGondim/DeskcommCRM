/**
 * Gate da 0774 em storage.objects: RLS OFF + sem privilégio NÃO pode GRANT SELECT.
 * RLS já ON + não-dono pode seguir sem ALTER. Swallow de 42501 no ENABLE era
 * fail-open: o GRANT depois via o bucket inteiro.
 */
import { afterAll, describe, expect, it } from "vitest";

import { lastLine, motivoDoErro, sql } from "./psql-transporte";

const SUFIXO = `${process.pid}`;
const OWNER = `deleg_rls_owner_${SUFIXO}`;
const APPLIER = `deleg_rls_applier_${SUFIXO}`;
const SCHEMA = `deleg_rls_probe_${SUFIXO}`;

function gateSql(qualificado: string): string {
  return `
    do $gate$
    declare
      rls_ligada boolean;
    begin
      select c.relrowsecurity into rls_ligada
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = split_part('${qualificado}', '.', 1)
         and c.relname = split_part('${qualificado}', '.', 2);
      if rls_ligada is not true then
        begin
          execute 'alter table ${qualificado} enable row level security';
        exception
          when insufficient_privilege then
            raise exception
              'delegacao 0774: storage.objects com RLS off e sem privilégio para ENABLE — abortar antes de GRANT SELECT a oauth_delegado'
              using errcode = '42501';
        end;
        select c.relrowsecurity into rls_ligada
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = split_part('${qualificado}', '.', 1)
           and c.relname = split_part('${qualificado}', '.', 2);
        if rls_ligada is not true then
          raise exception
            'delegacao 0774: storage.objects permanece com RLS off após ENABLE — abortar antes de GRANT SELECT a oauth_delegado';
        end if;
      end if;
      execute 'grant select on ${qualificado} to oauth_delegado';
    end
    $gate$;
  `;
}

afterAll(() => {
  sql(`
    reset role;
    drop schema if exists ${SCHEMA} cascade;
    drop role if exists ${APPLIER};
    drop role if exists ${OWNER};
  `);
});

describe("0774 — gate RLS: off+sem privilégio aborta; ON não-dono não ALTER", () => {
  it("prepara dono, aplicador NOSUPERUSER e tabela sonda", () => {
    sql(`
      reset role;
      drop schema if exists ${SCHEMA} cascade;
      drop role if exists ${APPLIER};
      drop role if exists ${OWNER};
      create role ${OWNER} nologin;
      create role ${APPLIER} nologin nosuperuser;
      grant ${OWNER} to current_user;
      grant ${APPLIER} to current_user;
      create schema ${SCHEMA} authorization ${OWNER};
      grant usage on schema ${SCHEMA} to ${APPLIER};
      set role ${OWNER};
      create table ${SCHEMA}.objects (id int);
      insert into ${SCHEMA}.objects values (1);
      reset role;
    `);
    expect(
      lastLine(
        sql(`select c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='${SCHEMA}' and c.relname='objects';`),
      ),
    ).toBe("false");
  });

  it("OFF + aplicador sem dono: RAISE 42501 e oauth_delegado NÃO ganha SELECT", () => {
    const antes = lastLine(
      sql(`select has_table_privilege('oauth_delegado', '${SCHEMA}.objects', 'select');`),
    );
    let recusou = false;
    let motivo = "";
    try {
      sql(`
        set role ${APPLIER};
        ${gateSql(`${SCHEMA}.objects`)}
      `);
    } catch (err) {
      motivo = motivoDoErro(err);
      recusou = /abortar antes de GRANT SELECT|42501|must be owner|permission denied/i.test(motivo);
    }
    sql(`reset role;`);
    expect(recusou, motivo.slice(0, 400)).toBe(true);
    expect(motivo).toMatch(/abortar antes de GRANT SELECT/);
    expect(
      lastLine(
        sql(`select c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='${SCHEMA}' and c.relname='objects';`),
      ),
    ).toBe("false");
    expect(
      lastLine(
        sql(`select has_table_privilege('oauth_delegado', '${SCHEMA}.objects', 'select');`),
      ),
    ).toBe(antes);
    expect(antes).toBe("f");
  });

  it("ON + aplicador não-dono: ramo ENABLE é pulado e RLS permanece ON", () => {
    sql(`
      reset role;
      set role ${OWNER};
      alter table ${SCHEMA}.objects enable row level security;
      reset role;
    `);
    expect(
      lastLine(
        sql(`select c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='${SCHEMA}' and c.relname='objects';`),
      ),
    ).toBe("true");
    sql(`
      set role ${APPLIER};
      do $on$
      declare
        rls_ligada boolean;
      begin
        select c.relrowsecurity into rls_ligada
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = '${SCHEMA}' and c.relname = 'objects';
        if rls_ligada is not true then
          raise exception 'não-dono não pode cair no ENABLE quando RLS já está ON';
        end if;
      end
      $on$;
      reset role;
    `);
    expect(
      lastLine(
        sql(`select c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='${SCHEMA}' and c.relname='objects';`),
      ),
    ).toBe("true");
  });
});
