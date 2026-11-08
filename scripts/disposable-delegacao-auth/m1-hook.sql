-- Hook descartável: copia claims de entrada; só o client_id mapeado
-- recebe role dedicada. NÃO entra no baseline nem na instalação viva.
create table if not exists public.m1_hook_config (
  k text primary key,
  v text not null
);

insert into public.m1_hook_config (k, v) values
  ('mode', 'map_role'),
  ('dedicated_role', 'oauth_delegado'),
  ('mapped_client_id', '00000000-0000-4000-8000-000000000000')
on conflict (k) do nothing;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claims jsonb;
  mapped text;
  dedicated text;
  mode text;
  cid text;
begin
  claims := coalesce(event->'claims', '{}'::jsonb);
  select v into mode from public.m1_hook_config where k = 'mode';
  select v into mapped from public.m1_hook_config where k = 'mapped_client_id';
  select v into dedicated from public.m1_hook_config where k = 'dedicated_role';
  cid := claims->>'client_id';

  if mode = 'omit_client_id' then
    claims := claims - 'client_id';
  elsif cid is not null
    and mapped is not null
    and dedicated is not null
    and cid = mapped then
    claims := jsonb_set(claims, '{role}', to_jsonb(dedicated), true);
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;

revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant usage, create on schema public to supabase_auth_admin;
grant select on table public.m1_hook_config to supabase_auth_admin;
