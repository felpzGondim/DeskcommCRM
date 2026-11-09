-- Ativação da leitura storage para oauth_delegado.
-- Papel autorizado: supabase_admin (dono do schema storage no stack
-- supabase/postgres:15.8.1.085). postgres NOSUPERUSER não tem GRANT OPTION
-- nem membership; o GRANT dele é WARNING inerte. Este arquivo TEM de correr
-- como o dono — se USAGE/SELECT não ficarem, aborta (não mascara ativação).
grant usage on schema storage to oauth_delegado;
grant select on storage.objects to oauth_delegado;
grant select on storage.buckets to oauth_delegado;
do $$
begin
  if not has_schema_privilege('oauth_delegado', 'storage', 'usage')
     or not has_table_privilege('oauth_delegado', 'storage.objects', 'select') then
    raise exception
      'delegacao: ativação storage recusada (aplicador=%, precisa supabase_admin)'
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
