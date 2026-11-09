/**
 * Reversão ensaiada da 0774: snapshot de CATÁLOGOS (policies/ACL/papel/RLS/hook),
 * não dump de conversa/storage. 0774 não escreve dado de atendimento.
 * Equivalência: estado pós-baseline == rollback + reaplicar 0774 e a ativação
 * storage (o mesmo par do rollout: migration + delegacao-storage-ativar.sql).
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
const ATIVAR = readFileSync("supabase/delegacao-storage-ativar.sql", "utf8");

function aplicar0774EAtivar(): void {
  sql(MIGRACAO);
  sql(ATIVAR);
}

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

  it("pós-rollback é o catálogo pré-0774 (exceto ratchet RLS); reaplicar restaura 0774", () => {
    type Cat = {
      membership_authenticator_oauth?: boolean;
      rls_storage_objects?: boolean;
      funcoes?: unknown;
      hook_sql?: unknown;
      acl?: Array<{ rel: string; oauth_select?: boolean }>;
    };
    const com0774 = catalogo() as Cat;
    try {
      sql(ROLLBACK);
      const pre0774 = catalogo() as Cat;
      expect(pre0774).not.toEqual(com0774);
      expect(pre0774.membership_authenticator_oauth).toBe(false);
      expect(pre0774.funcoes).toEqual([]);
      expect(pre0774.hook_sql ?? null).toBeNull();
      expect(pre0774.acl?.every((a) => a.oauth_select === false)).toBe(true);
      // Ratchet: 0774 pode ENABLE; rollback nunca DISABLE. Stub nascia OFF;
      // live já era ON. Desligar seria mudar o produto, não desfazer 0774.
      expect(pre0774.rls_storage_objects).toBe(true);
      expect(com0774.rls_storage_objects).toBe(true);
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
      aplicar0774EAtivar();
      expect(catalogo()).toEqual(com0774);
      sql(ROLLBACK);
      expect(catalogo()).toEqual(pre0774);
      aplicar0774EAtivar();
      expect(catalogo()).toEqual(com0774);
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
