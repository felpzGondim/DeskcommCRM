-- Ativação da leitura storage para oauth_delegado (USAGE + SELECT).
-- Sem trocar o papel da sessão e sem exigir o nome do dono. O aplicador
-- é a conexão administrativa que já aplica o schema:
--   • CRM gerenciado: postgres NOSUPERUSER com GRANT OPTION de USAGE
--     (grantor supabase_admin) e de SELECT em objects/buckets (grantor
--     supabase_storage_admin) — sem membership dos owners, sem credencial nova.
--   • stack e2e local (supabase/postgres:15.8.1.085): postgres NÃO tem
--     GRANT OPTION; o passo do e2e corre este arquivo como supabase_admin
--     (papel que o stack já tem).
-- Tenta o GRANT mínimo e aborta se has_schema_privilege /
-- has_table_privilege não ficarem. oauth_delegado nasce na 0774; este
-- arquivo não cria o papel.
do $$
begin
  if to_regclass('storage.objects') is null then
    raise exception
      'delegacao: storage.objects ausente — aplique o schema storage antes'
      using errcode = '42501';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'oauth_delegado') then
    raise exception
      'delegacao: oauth_delegado ausente — aplique o schema 0774 antes'
      using errcode = '42501';
  end if;
  begin
    execute 'grant usage on schema storage to oauth_delegado';
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    execute 'grant select on storage.objects to oauth_delegado';
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    execute 'grant select on storage.buckets to oauth_delegado';
  exception
    when insufficient_privilege then
      null;
  end;
  if not has_schema_privilege('oauth_delegado', 'storage', 'usage')
     or not has_table_privilege('oauth_delegado', 'storage.objects', 'select') then
    raise exception
      'delegacao: ativação storage recusada (aplicador=%; USAGE/SELECT não ficaram em oauth_delegado)'
      , current_user
      using errcode = '42501';
  end if;
  if has_table_privilege('oauth_delegado', 'storage.objects', 'insert')
     or has_table_privilege('oauth_delegado', 'storage.objects', 'update')
     or has_table_privilege('oauth_delegado', 'storage.objects', 'delete')
     or has_table_privilege('oauth_delegado', 'storage.objects', 'truncate') then
    raise exception
      'delegacao: ativação storage concedeu escrita — recusar'
      using errcode = '42501';
  end if;
end
$$;
