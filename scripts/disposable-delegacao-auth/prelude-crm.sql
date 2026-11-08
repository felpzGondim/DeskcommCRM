-- Espelho do prelude de scripts/test-db.sh (roles + extensions + stubs).
-- Usado só no banco descartável m2_crm. Não é o produto.
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
end
$$;

grant anon, authenticated, service_role to authenticator;

alter default privileges for role ubuntu in schema public grant all on functions to anon;
alter default privileges for role ubuntu in schema public grant all on functions to authenticated;
alter default privileges for role ubuntu in schema public grant all on functions to service_role;
alter default privileges for role ubuntu in schema public revoke execute on functions from public;

alter default privileges for role ubuntu in schema public grant all on tables to anon;
alter default privileges for role ubuntu in schema public grant all on tables to authenticated;
alter default privileges for role ubuntu in schema public grant all on tables to service_role;

-- também postgres, se o dump criar objetos como postgres
alter default privileges for role postgres in schema public grant all on functions to anon;
alter default privileges for role postgres in schema public grant all on functions to authenticated;
alter default privileges for role postgres in schema public grant all on functions to service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public grant all on tables to anon;
alter default privileges for role postgres in schema public grant all on tables to authenticated;
alter default privileges for role postgres in schema public grant all on tables to service_role;

create schema if not exists auth;
create schema if not exists extensions;

create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema public;
create extension if not exists citext with schema public;
create extension if not exists pg_trgm with schema public;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists auth.sessions (
  id uuid primary key, user_id uuid not null references auth.users(id),
  aal text, not_after timestamptz
);
create table if not exists auth.mfa_factors (
  id uuid primary key, user_id uuid not null references auth.users(id), status text, factor_type text default 'totp'
);
create or replace function auth.jwt() returns jsonb language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim',true),''),nullif(current_setting('request.jwt.claims',true),''))::jsonb;
$$;
create or replace function auth.uid() returns uuid
  language sql stable
  as $fn$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $fn$;

grant usage on schema auth, extensions, storage to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;
