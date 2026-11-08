import { afterAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * PUBLIC vs papel dedicado (NOINHERIT). Postgres efêmero de `pnpm test:db`.
 * Cria papel e função DESCARTÁVEIS; não entra no baseline; não configura Auth.
 *
 * Prova: GRANT TO PUBLIC alcança o papel novo mesmo NOINHERIT e sem ser
 * membro de authenticated. Cookie (`authenticated`) não perde EXECUTE das
 * DEFINER do produto. Sem SET ROLE authenticator persistente.
 */

const PAPEL = "delegacao_probe_oauth";
const FN = "public.fn_delegacao_probe_publico()";

function priv(role: string, fn: string): boolean {
  return (
    sql(`select has_function_privilege('${role}', '${fn}'::regprocedure, 'execute');`) === "t"
  );
}

afterAll(() => {
  sql(`
    drop function if exists public.fn_delegacao_probe_publico();
    do $u$ begin
      execute 'revoke usage on schema public from ${PAPEL}';
    exception when undefined_object then null;
    end $u$;
    drop role if exists ${PAPEL};
  `);
});

describe.sequential("papel dedicado + PUBLIC — isolamento RPC (sintético)", () => {
  it("NOINHERIT sem GRANT próprio não herda EXECUTE de authenticated nas DEFINER voláteis", () => {
    sql(`
      do $r$ begin
        if not exists (select 1 from pg_roles where rolname = '${PAPEL}') then
          create role ${PAPEL} nologin noinherit;
        end if;
      end $r$;
    `);
    const lgpd = sql(`
      select p.oid::regprocedure::text
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = 'fn_lgpd_anonymize_contact'
         and p.prosecdef
       order by 1
       limit 1;
    `);
    expect(lgpd.length, "vacuidade: fn_lgpd_anonymize_contact sumiu").toBeGreaterThan(0);
    expect(priv("authenticated", lgpd), "cookie/Inbox precisa deste EXECUTE").toBe(true);
    expect(priv("anon", lgpd), "anon não pode herdar a DEFINER").toBe(false);
    expect(priv(PAPEL, lgpd), "NOINHERIT sem membership não pega GRANT a authenticated").toBe(
      false,
    );
    expect(sql(`select pg_has_role('${PAPEL}', 'authenticated', 'member');`)).toBe("f");
    expect(sql(`select has_table_privilege('${PAPEL}', 'public.conversations', 'select');`)).toBe(
      "f",
    );
  });

  it("GRANT TO PUBLIC alcança o papel NOINHERIT — papel dedicado sozinho não isola", () => {
    sql(`
      create or replace function public.fn_delegacao_probe_publico()
      returns int
      language sql
      security invoker
      set search_path = public
      as $$ select 1 $$;
      revoke all on function public.fn_delegacao_probe_publico() from public, anon, authenticated;
      grant usage on schema public to ${PAPEL};
    `);
    expect(priv(PAPEL, FN), "depois do revoke, probe não executa").toBe(false);
    sql(`grant execute on function public.fn_delegacao_probe_publico() to public;`);
    expect(priv(PAPEL, FN), "PUBLIC ignora NOINHERIT").toBe(true);
    expect(priv("authenticated", FN), "PUBLIC também alcança authenticated").toBe(true);
    const out = sql(`
      set role ${PAPEL};
      select public.fn_delegacao_probe_publico();
    `);
    expect(lastLine(out), "probe COM public grant executa (evidência, não desejado em produto)").toBe(
      "1",
    );
  });

  it("sem PUBLIC, SET ROLE probe recusa EXECUTE; authenticated continua com a DEFINER do produto", () => {
    sql(`revoke execute on function public.fn_delegacao_probe_publico() from public;`);
    const recusa = (() => {
      try {
        sql(`
          set role ${PAPEL};
          select public.fn_delegacao_probe_publico();
        `);
        return "executou";
      } catch (err) {
        return String((err as { stderr?: string }).stderr ?? err);
      }
    })();
    expect(recusa).toMatch(/permission denied/i);
    const lgpd = sql(`
      select p.oid::regprocedure::text
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'fn_lgpd_anonymize_contact'
       limit 1;
    `);
    expect(priv("authenticated", lgpd)).toBe(true);
  });

  it("authenticator, se existir, é membro de authenticated e não do probe", () => {
    const existe = sql(`select exists(select 1 from pg_roles where rolname = 'authenticator');`);
    if (existe !== "t") {
      expect(existe, "sem PostgREST neste Postgres efêmero — não inventar membership").toBe("f");
      return;
    }
    expect(sql(`select pg_has_role('authenticator', 'authenticated', 'member');`)).toBe("t");
    expect(sql(`select pg_has_role('authenticator', '${PAPEL}', 'member');`)).toBe("f");
  });

  it("cookie JWT (client_id nulo) não perde SELECT de conversations após o probe", () => {
    const n = lastLine(
      sql(`
        set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', false);
        select count(*)::text from public.conversations;
      `),
    );
    expect(/^\d+$/.test(n), `count cookie inesperado: ${n}`).toBe(true);
  });

  it("client_id não registrado + SET ROLE authenticated: SELECT numérico (RLS, não crash); prova de grant está na suíte de visibilidade", () => {
    const n = lastLine(
      sql(`
        set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","client_id":"client-nao-registrado"}', false);
        select count(*)::text from public.conversations;
      `),
    );
    expect(/^\d+$/.test(n), `count oauth sem grant inesperado: ${n}`).toBe(true);
  });
});
