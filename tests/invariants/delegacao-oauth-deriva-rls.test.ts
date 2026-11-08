import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * Deriva do catálogo: JWT OAuth (`authenticated` + client_id) não herda
 * tabela RLS nova, view definer, nem EXECUTE extra. Roda só em `pnpm test:db`.
 *
 * Allowlist = as cinco tabelas com leitura grant-aware (migration 0773).
 * O resto precisa da restritiva `oauth_cookie_only`. Cookie não usa esta
 * varredura: `client_id` nulo passa na USING.
 */

const ALLOWLIST = [
  "conversations",
  "messages",
  "contacts",
  "channel_sessions",
  "delegacao_visibilidade_corporativa",
] as const;

function linhas(out: string): string[] {
  return out.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}

describe("derivação OAuth default-deny (catálogo, sem token real)", () => {
  it("toda tabela public com RLS fora da allowlist tem oauth_cookie_only restritiva", () => {
    const allow = ALLOWLIST.map((t) => `'${t}'`).join(",");
    const faltando = linhas(
      sql(`
        select c.relname
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where c.relkind in ('r', 'p')
           and c.relrowsecurity
           and n.nspname = 'public'
           and c.relname not in (${allow})
           and not exists (
             select 1 from pg_policy p
              where p.polrelid = c.oid
                and p.polname = 'oauth_cookie_only'
                and p.polpermissive = false
           )
         order by 1;
      `),
    );
    expect(faltando, "tabela RLS nova sem oauth_cookie_only — o JWT OAuth herda as permissivas").toEqual([]);
  });

  it("storage.objects tem oauth_cookie_only restritiva quando RLS está ligada", () => {
    const rls = sql(`
      select c.relrowsecurity::text
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'storage' and c.relname = 'objects';
    `);
    if (rls !== "t") {
      expect(rls, "storage.objects ausente ou sem RLS — registrar, não silenciar").toBe("f");
      return;
    }
    expect(
      sql(`
        select count(*)::text
          from pg_policy p
          join pg_class c on c.oid = p.polrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'storage'
           and c.relname = 'objects'
           and p.polname = 'oauth_cookie_only'
           and p.polpermissive = false;
      `),
    ).toBe("1");
  });

  it("contacts e channel_sessions têm SELECT grant-aware restritiva, não oauth_cookie_only FOR ALL", () => {
    expect(
      sql(`
        select count(*)::text
          from pg_policy p
          join pg_class c on c.oid = p.polrelid
         where c.relname = 'contacts'
           and p.polname = 'oauth_delegacao_select'
           and p.polpermissive = false
           and p.polcmd = 'r';
      `),
    ).toBe("1");
    expect(
      sql(`
        select count(*)::text
          from pg_policy p
          join pg_class c on c.oid = p.polrelid
         where c.relname = 'channel_sessions'
           and p.polname = 'oauth_delegacao_select'
           and p.polpermissive = false
           and p.polcmd = 'r';
      `),
    ).toBe("1");
    expect(
      sql(`
        select count(*)::text
          from pg_policy p
          join pg_class c on c.oid = p.polrelid
         where c.relname in ('contacts', 'channel_sessions')
           and p.polname = 'oauth_cookie_only';
      `),
    ).toBe("0");
  });

  it("view public concedida a authenticated sem security_invoker permanece vazia", () => {
    const views = linhas(
      sql(`
        select n.nspname || '.' || c.relname
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where c.relkind = 'v'
           and n.nspname = 'public'
           and has_table_privilege('authenticated', c.oid, 'select')
           and not exists (
             select 1 from unnest(coalesce(c.reloptions, '{}'::text[])) opt
              where opt = 'security_invoker=true'
           )
         order by 1;
      `),
    );
    expect(
      views,
      "view sem security_invoker concedida a authenticated lê como dono — o JWT OAuth herdaria",
    ).toEqual([]);
  });

  it("SECURITY DEFINER volátil executável por authenticated não consulta client_id (buraco herdado, não alargado)", () => {
    const total = Number(
      sql(`
        select count(*)::text
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.prosecdef
           and p.provolatile = 'v'
           and has_function_privilege('authenticated', p.oid, 'execute');
      `),
    );
    expect(total, "vacuidade: o allowlist de definer volátil some e o teste fica cego").toBeGreaterThan(0);
    const comClientId = linhas(
      sql(`
        select p.oid::regprocedure::text
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.prosecdef
           and p.provolatile = 'v'
           and has_function_privilege('authenticated', p.oid, 'execute')
           and pg_get_functiondef(p.oid) ilike '%client_id%'
         order by 1;
      `),
    );
    expect(
      comClientId,
      "se uma definer volátil passou a ler client_id, declare no AUTHENTICATED_PERMITIDO e na matriz; não assuma que 0773 a fechou",
    ).toEqual([]);
  });

  it("0773 não reconcedeu EXECUTE a authenticated em função pública (probe de não-alargamento)", () => {
    // Privilegio de papel, não JWT: o JWT OAuth é o mesmo authenticated.
    // Este caso só trava GRANT extra futuro na allowlist da matriz.
    expect(
      sql(`
        select count(*)::text
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname like 'fn_delegacao%'
           and has_function_privilege('authenticated', p.oid, 'execute');
      `),
    ).toBe("0");
  });
});
