-- M2 sintético: PUBLIC vs NOINHERIT, authenticator SET ROLE, policies TO
-- papel dedicado, duas identidades, org/personal/unknown/client/revoked.
-- Não entra no baseline. Banco m2_synth.
\set ON_ERROR_STOP on

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists m2;

create table if not exists m2.results (
  id text primary key,
  ok boolean not null,
  detail text
);

create or replace function m2.assert(p_id text, p_ok boolean, p_detail text default '')
returns void language plpgsql
security definer
set search_path = m2, public
as $$
begin
  insert into m2.results(id, ok, detail) values (p_id, p_ok, p_detail)
  on conflict (id) do update set ok = excluded.ok, detail = excluded.detail;
  if not p_ok then
    raise notice 'FAIL % %', p_id, p_detail;
  else
    raise notice 'PASS %', p_id;
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'oauth_delegado') then
    create role oauth_delegado nologin noinherit;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;
-- ainda SEM grant de oauth_delegado a authenticator — medido abaixo

grant usage on schema public, auth, storage, m2 to anon, authenticated, service_role, oauth_delegado, authenticator;

drop table if exists public.m2_membership cascade;
drop table if exists public.m2_grants cascade;
drop table if exists public.m2_documents cascade;
drop table if exists public.m2_conversations cascade;
drop table if exists storage.objects cascade;
drop table if exists storage.buckets cascade;

create table public.m2_membership (
  user_id uuid not null,
  organization_id uuid not null,
  primary key (user_id, organization_id)
);
create table public.m2_grants (
  id uuid primary key,
  organization_id uuid not null,
  user_id uuid not null,
  oauth_client_id text not null,
  revoked_at timestamptz,
  expires_at timestamptz not null
);
create table public.m2_conversations (
  id uuid primary key,
  organization_id uuid not null,
  owner uuid not null,
  kind text not null, -- corporativa | pessoal | unknown
  is_personal boolean not null default false
);
create table public.m2_documents (
  id uuid primary key,
  organization_id uuid not null,
  conversation_id uuid references public.m2_conversations(id)
);
create table storage.buckets (id text primary key, name text not null);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid
);

create or replace function auth.uid() returns uuid
  language sql stable
  as $fn$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $fn$;

create or replace function auth.jwt() returns jsonb
  language sql stable
  as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb;
  $$;

create or replace function public.fn_user_org_ids() returns uuid[]
  language sql stable security invoker
  set search_path = public
  as $$
    select coalesce(array_agg(organization_id), '{}')
      from public.m2_membership
     where user_id = auth.uid();
  $$;

alter table public.m2_conversations enable row level security;
alter table public.m2_documents enable row level security;
alter table public.m2_grants enable row level security;
alter table storage.objects enable row level security;

revoke all on public.m2_conversations, public.m2_documents, public.m2_grants, public.m2_membership, storage.objects from public, anon, authenticated, oauth_delegado;
grant select on public.m2_membership to authenticated, oauth_delegado;
grant select, update on public.m2_conversations to authenticated, oauth_delegado;
grant select, insert, update on public.m2_documents to authenticated, oauth_delegado;
grant select on public.m2_grants to authenticated, oauth_delegado;
grant select on storage.objects to authenticated, oauth_delegado;

-- cookie: membership da org, sem olhar client_id
create policy m2_grants_own on public.m2_grants
  as permissive for select to authenticated, oauth_delegado
  using (user_id = auth.uid());

create policy m2_conv_cookie on public.m2_conversations
  as permissive for select to authenticated
  using (organization_id = any (public.fn_user_org_ids()));
create policy m2_conv_cookie_upd on public.m2_conversations
  as permissive for update to authenticated
  using (organization_id = any (public.fn_user_org_ids()))
  with check (organization_id = any (public.fn_user_org_ids()));

-- oauth dedicado: só corporativa + grant vivo do client_id
create policy m2_conv_oauth on public.m2_conversations
  as permissive for select to oauth_delegado
  using (
    kind = 'corporativa'
    and not is_personal
    and exists (
      select 1 from public.m2_grants g
       where g.user_id = auth.uid()
         and g.organization_id = m2_conversations.organization_id
         and g.oauth_client_id = auth.jwt()->>'client_id'
         and g.revoked_at is null
         and g.expires_at > now()
    )
  );
-- oauth não escreve
create policy m2_conv_oauth_no_write on public.m2_conversations
  as restrictive for update to oauth_delegado
  using (false);

create policy m2_doc_cookie on public.m2_documents
  as permissive for select to authenticated
  using (organization_id = any (public.fn_user_org_ids()));
create policy m2_doc_oauth_deny on public.m2_documents
  as restrictive for all to oauth_delegado
  using (false);

create policy m2_storage_deny_oauth on storage.objects
  as restrictive for all to oauth_delegado
  using (false);
create policy m2_storage_cookie on storage.objects
  as permissive for select to authenticated
  using (true);

-- probe PUBLIC EXECUTE
create or replace function public.fn_m2_probe_publico() returns int
  language sql security invoker set search_path = public
  as $$ select 1 $$;
revoke all on function public.fn_m2_probe_publico() from public, anon, authenticated, oauth_delegado;

create or replace function public.fn_m2_definer_cookie() returns int
  language sql security definer set search_path = public
  as $$ select 7 $$;
revoke all on function public.fn_m2_definer_cookie() from public, anon, oauth_delegado;
grant execute on function public.fn_m2_definer_cookie() to authenticated;

-- fixtures
delete from public.m2_grants;
delete from public.m2_documents;
delete from public.m2_conversations;
delete from public.m2_membership;
delete from storage.objects;
delete from storage.buckets;

insert into public.m2_membership values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001'), -- marina org A
  ('aaaaaaaa-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001'), -- felipe org A
  ('aaaaaaaa-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000002'); -- membro org B

insert into public.m2_conversations values
  ('cccccccc-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'corporativa', false),
  ('cccccccc-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'pessoal', true),
  ('cccccccc-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'unknown', false),
  ('cccccccc-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003', 'corporativa', false);

insert into public.m2_documents values
  ('dddddddd-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001');

insert into public.m2_grants values
  ('eeeeeeee-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'client-aprovado', null, now() + interval '1 day'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'client-outro', null, now() + interval '1 day');

insert into storage.buckets values ('whatsapp-media', 'whatsapp-media');
insert into storage.objects (id, bucket_id, name, owner)
  values ('ffffffff-0000-4000-8000-000000000001', 'whatsapp-media', 'x.bin', 'aaaaaaaa-0000-4000-8000-000000000002');

-- membership: oauth_delegado NÃO é membro de authenticated
select m2.assert(
  'm2.no_authenticated_membership',
  not pg_has_role('oauth_delegado', 'authenticated', 'member'),
  'oauth_delegado must not inherit authenticated'
);

select m2.assert(
  'm2.usage_public_granted',
  has_schema_privilege('oauth_delegado', 'public', 'usage'),
  'USAGE on public'
);

-- GRANT TO PUBLIC alcança NOINHERIT
grant execute on function public.fn_m2_probe_publico() to public;
select m2.assert(
  'm2.public_execute_reaches_dedicated',
  has_function_privilege('oauth_delegado', 'public.fn_m2_probe_publico()', 'execute'),
  'PUBLIC ignores NOINHERIT'
);
select m2.assert(
  'm2.public_execute_reaches_authenticated',
  has_function_privilege('authenticated', 'public.fn_m2_probe_publico()', 'execute'),
  'PUBLIC also reaches cookie role'
);
revoke execute on function public.fn_m2_probe_publico() from public;
select m2.assert(
  'm2.revoke_public_drops_dedicated',
  not has_function_privilege('oauth_delegado', 'public.fn_m2_probe_publico()', 'execute'),
  'after revoke PUBLIC'
);

-- DEFINER do cookie: authenticated sim, oauth_delegado não
select m2.assert(
  'm2.definer_authenticated_only',
  has_function_privilege('authenticated', 'public.fn_m2_definer_cookie()', 'execute')
  and not has_function_privilege('oauth_delegado', 'public.fn_m2_definer_cookie()', 'execute'),
  'DEFINER grant is per-role, not PUBLIC'
);

-- authenticator SET ROLE: session_user tem de ser authenticator (não o superuser).
do $$
declare
  ok boolean := false;
  err text := 'no error';
begin
  set session authorization authenticator;
  begin
    set role oauth_delegado;
    ok := false;
  exception when insufficient_privilege then
    ok := true;
    err := sqlerrm;
  end;
  set session authorization default;
  perform m2.assert('m2.authenticator_set_role_denied_without_grant', ok, err);
end
$$;

grant oauth_delegado to authenticator;
do $$
declare
  ok boolean := false;
  who text;
begin
  set session authorization authenticator;
  set role oauth_delegado;
  who := current_user;
  ok := who = 'oauth_delegado';
  set session authorization default;
  perform m2.assert('m2.authenticator_set_role_after_grant', ok, who);
end
$$;

-- helpers STABLE visíveis
select m2.assert(
  'm2.helpers_stable',
  (select prosecdef is false and provolatile = 's' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='fn_user_org_ids')
  and (select provolatile = 's' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='auth' and p.proname='uid'),
  'fn_user_org_ids and auth.uid are STABLE'
);

-- sessão: SET ROLE + jwt claims
create or replace function m2.count_as(role_name text, claims jsonb, q text) returns int
language plpgsql as $$
declare n int;
begin
  execute format('set local role %I', role_name);
  perform set_config('request.jwt.claims', claims::text, true);
  execute q into n;
  reset role;
  return n;
exception when others then
  reset role;
  raise;
end;
$$;

select m2.assert(
  'm2.cookie_felipe_sees_personal',
  m2.count_as('authenticated', '{"sub":"aaaaaaaa-0000-4000-8000-000000000002","role":"authenticated"}'::jsonb,
    $$select count(*) from public.m2_conversations where id = 'cccccccc-0000-4000-8000-000000000002'$$) = 1,
  'cookie admin sees personal'
);
select m2.assert(
  'm2.cookie_marina_sees_org',
  m2.count_as('authenticated', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}'::jsonb,
    $$select count(*) from public.m2_conversations where organization_id = 'bbbbbbbb-0000-4000-8000-000000000001'$$) = 3,
  'cookie membership sees all kinds in org'
);

select m2.assert(
  'm2.oauth_grant_sees_corp_only',
  m2.count_as('oauth_delegado', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"oauth_delegado","client_id":"client-aprovado"}'::jsonb,
    $$select count(*) from public.m2_conversations where id = 'cccccccc-0000-4000-8000-000000000001'$$) = 1,
  'mapped grant + corp'
);
select m2.assert(
  'm2.oauth_denies_personal',
  m2.count_as('oauth_delegado', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"oauth_delegado","client_id":"client-aprovado"}'::jsonb,
    $$select count(*) from public.m2_conversations where id = 'cccccccc-0000-4000-8000-000000000002'$$) = 0,
  'personal'
);
select m2.assert(
  'm2.oauth_denies_unknown',
  m2.count_as('oauth_delegado', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"oauth_delegado","client_id":"client-aprovado"}'::jsonb,
    $$select count(*) from public.m2_conversations where id = 'cccccccc-0000-4000-8000-000000000003'$$) = 0,
  'unknown'
);
select m2.assert(
  'm2.oauth_denies_other_org',
  m2.count_as('oauth_delegado', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"oauth_delegado","client_id":"client-aprovado"}'::jsonb,
    $$select count(*) from public.m2_conversations where id = 'cccccccc-0000-4000-8000-000000000004'$$) = 0,
  'org B'
);
select m2.assert(
  'm2.oauth_unapproved_client',
  m2.count_as('oauth_delegado', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"oauth_delegado","client_id":"client-desconhecido"}'::jsonb,
    $$select count(*) from public.m2_conversations where id = 'cccccccc-0000-4000-8000-000000000001'$$) = 0,
  'unknown client'
);
select m2.assert(
  'm2.oauth_identity_without_grant',
  m2.count_as('oauth_delegado', '{"sub":"aaaaaaaa-0000-4000-8000-000000000002","role":"oauth_delegado","client_id":"client-aprovado"}'::jsonb,
    $$select count(*) from public.m2_conversations where id = 'cccccccc-0000-4000-8000-000000000001'$$) = 0,
  'felipe has other client grant'
);

update public.m2_grants set revoked_at = now() where id = 'eeeeeeee-0000-4000-8000-000000000001';
select m2.assert(
  'm2.oauth_revoked_grant',
  m2.count_as('oauth_delegado', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"oauth_delegado","client_id":"client-aprovado"}'::jsonb,
    $$select count(*) from public.m2_conversations where id = 'cccccccc-0000-4000-8000-000000000001'$$) = 0,
  'revoked'
);
update public.m2_grants set revoked_at = null where id = 'eeeeeeee-0000-4000-8000-000000000001';

select m2.assert(
  'm2.oauth_documents_denied',
  m2.count_as('oauth_delegado', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"oauth_delegado","client_id":"client-aprovado"}'::jsonb,
    $$select count(*) from public.m2_documents$$) = 0,
  'documents default deny'
);
select m2.assert(
  'm2.cookie_documents_allowed',
  m2.count_as('authenticated', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}'::jsonb,
    $$select count(*) from public.m2_documents$$) = 1,
  'cookie documents'
);
select m2.assert(
  'm2.oauth_storage_denied',
  m2.count_as('oauth_delegado', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"oauth_delegado","client_id":"client-aprovado"}'::jsonb,
    $$select count(*) from storage.objects$$) = 0,
  'storage'
);
select m2.assert(
  'm2.cookie_storage_allowed',
  m2.count_as('authenticated', '{"sub":"aaaaaaaa-0000-4000-8000-000000000002","role":"authenticated"}'::jsonb,
    $$select count(*) from storage.objects$$) = 1,
  'cookie storage'
);

-- write denial oauth vs cookie update
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"oauth_delegado","client_id":"client-aprovado"}', true);
  set local role oauth_delegado;
  begin
    update public.m2_conversations set kind = 'hack' where id = 'cccccccc-0000-4000-8000-000000000001';
    get diagnostics n = row_count;
  exception when insufficient_privilege or others then
    n := 0;
  end;
  perform m2.assert('m2.oauth_write_denied', n = 0, n::text);
end
$$;

do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000002","role":"authenticated"}', true);
  set local role authenticated;
  update public.m2_conversations set kind = 'corporativa' where id = 'cccccccc-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  perform m2.assert('m2.cookie_write_unaffected', n = 1, n::text);
end
$$;

-- via authenticator SET ROLE (caminho PostgREST)
do $$
declare n int;
begin
  set session authorization authenticator;
  set role oauth_delegado;
  perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"oauth_delegado","client_id":"client-aprovado"}', true);
  select count(*) into n from public.m2_conversations where id = 'cccccccc-0000-4000-8000-000000000001';
  set session authorization default;
  perform m2.assert('m2.authenticator_switch_reads_corp', n = 1, n::text);
end
$$;

select id, ok, detail from m2.results order by id;
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail, count(*) as total
  from m2.results;
do $$
begin
  if exists (select 1 from m2.results where not ok) then
    raise exception 'm2 failures: %', (select string_agg(id, ',') from m2.results where not ok);
  end if;
end $$;
