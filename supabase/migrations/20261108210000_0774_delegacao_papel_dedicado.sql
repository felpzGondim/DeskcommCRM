-- manifest: Papel Postgres oauth_delegado (NOINHERIT) para leitura corporativa delegada: CREATE ROLE, GRANT ao authenticator, hook versionado por client_id autorizado, tabelas de client/grant sem semente, policies TO o papel só em conversas/mensagens/contatos/documentos/storage corporativos, desconhecido e pessoal recusam, REVOKE de PUBLIC/EXECUTE/TRUNCATE no papel. Cookie/authenticated intocado. Sem policy global experimental. Sem ativar o hook no Auth da instalação.
--
-- Inbox por cookie não muda. HTTP de delegação não nasce aqui. O hook SQL existe;
-- ligá-lo no Auth (GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN) é passo de implantação, não
-- deste arquivo. Nenhuma linha de grant/client nasce com o schema.

-- Papel dedicado: NÃO herda authenticated. PUBLIC ainda alcança NOINHERIT —
-- por isso o REVOKE explícito abaixo, não só a ausência de GRANT.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'oauth_delegado') then
    create role oauth_delegado nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator nologin noinherit;
  end if;
end
$$;

grant usage on schema public to oauth_delegado;
grant usage on schema auth to oauth_delegado;
grant usage on schema storage to oauth_delegado;
grant oauth_delegado to authenticator;

-- Clients autorizados (instalação, não org). O hook só troca role neste conjunto.
-- Sem organization_id de propósito: o hook vê client_id, não org. O grant por
-- org+uid é a autorização de linha.
create table if not exists public.delegacao_clientes_autorizados (
  oauth_client_id text primary key
    check (char_length(trim(oauth_client_id)) > 0),
  hook_version int not null default 1 check (hook_version >= 1),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.delegacao_clientes_autorizados is
  'OAuth clients cujo JWT pode receber role=oauth_delegado no hook. Vazio = ninguém. Sem PII. Sem semente.';

alter table public.delegacao_clientes_autorizados enable row level security;

revoke all on public.delegacao_clientes_autorizados from public, anon, authenticated, oauth_delegado;
grant all on public.delegacao_clientes_autorizados to service_role;

-- Grant auditável: uid + client + org. Sem linha = recusa. JWT exp não revoga.
create table if not exists public.delegacao_visibilidade_corporativa (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  oauth_client_id text not null check (char_length(trim(oauth_client_id)) > 0),
  efeitos text[] not null check (
    efeitos <> '{}'::text[]
    and efeitos <@ array['buscar','ler','baixar']::text[]
  ),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

drop index if exists public.delegacao_visibilidade_corporativa_ativa_uidx;
create unique index if not exists delegacao_visibilidade_corporativa_ativa_uidx
  on public.delegacao_visibilidade_corporativa (organization_id, user_id, oauth_client_id)
  where revoked_at is null;

create index if not exists delegacao_visibilidade_corporativa_org_user_idx
  on public.delegacao_visibilidade_corporativa (organization_id, user_id);

comment on table public.delegacao_visibilidade_corporativa is
  'Grant da leitura corporativa delegada. Linha viva + JWT role=oauth_delegado + client_id. Sem linha = recusa. Nenhuma linha nasce com o schema.';

alter table public.delegacao_visibilidade_corporativa enable row level security;

revoke all on public.delegacao_visibilidade_corporativa from public, anon, authenticated, oauth_delegado;
grant select on public.delegacao_visibilidade_corporativa to oauth_delegado;
grant all on public.delegacao_visibilidade_corporativa to service_role;

drop policy if exists delegacao_visibilidade_corporativa_select on public.delegacao_visibilidade_corporativa;
create policy delegacao_visibilidade_corporativa_select
  on public.delegacao_visibilidade_corporativa
  as permissive
  for select
  to oauth_delegado
  using (user_id = auth.uid());

-- Grant vivo: INVOKER (RLS do grant vale). Só o papel dedicado executa.
create or replace function public.fn_delegacao_grant_vivo(p_org uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
      from public.delegacao_visibilidade_corporativa g
     where g.user_id = auth.uid()
       and g.organization_id = p_org
       and g.oauth_client_id = nullif(btrim(coalesce(auth.jwt()->>'client_id', '')), '')
       and g.revoked_at is null
       and g.expires_at > now()
       and g.efeitos && array['buscar','ler','baixar']::text[]
  );
$$;

revoke all on function public.fn_delegacao_grant_vivo(uuid) from public, anon, authenticated;
grant execute on function public.fn_delegacao_grant_vivo(uuid) to oauth_delegado;

-- Hook versionado: só client_id autorizado (não revogado) vira oauth_delegado.
-- Copia as claims (replace do Auth). Cookie sem client_id permanece authenticated.
-- Não lê nome, e-mail nem user_metadata.
create or replace function public.fn_delegacao_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims jsonb;
  cid text;
  versao int;
begin
  claims := coalesce(event->'claims', '{}'::jsonb);
  cid := nullif(btrim(coalesce(claims->>'client_id', '')), '');
  if cid is not null then
    select c.hook_version into versao
      from public.delegacao_clientes_autorizados c
     where c.oauth_client_id = cid
       and c.revoked_at is null;
    if found then
      claims := jsonb_set(claims, '{role}', to_jsonb('oauth_delegado'::text), true);
      claims := jsonb_set(claims, '{delegacao_hook_version}', to_jsonb(versao), true);
    end if;
  end if;
  return jsonb_set(coalesce(event, '{}'::jsonb), '{claims}', claims, true);
end;
$$;

revoke all on function public.fn_delegacao_access_token_hook(jsonb) from public, anon, authenticated, oauth_delegado;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.fn_delegacao_access_token_hook(jsonb) to supabase_auth_admin;
    grant usage on schema public to supabase_auth_admin;
  end if;
end
$$;

comment on function public.fn_delegacao_access_token_hook(jsonb) is
  'Custom Access Token Hook (v1): mapeia client_id autorizado para role=oauth_delegado. Ligar no Auth é config, não este SQL.';

-- Policies de SELECT dessas tabelas nasciam sem TO (valem para todo papel).
-- oauth_delegado ganha GRANT SELECT; sem recortar TO authenticated, a policy
-- da cookie (fn_conversation_scope / fn_user_org_ids) rodaria como dono da
-- tabela e entregaria o pessoal. O corpo USING da cookie NÃO muda.
drop policy if exists "conversations_select" on public.conversations;
create policy "conversations_select" on public.conversations
  for select to authenticated
  using (
    (select public.fn_is_platform_admin())
    or organization_id in (
         select s.organization_id from public.fn_conversation_scope() s where s.org_wide_read
       )
    or (
         assigned_to_user_id = auth.uid()
         and organization_id in (select s.organization_id from public.fn_conversation_scope() s)
       )
    or (
         assigned_to_user_id is null
         and organization_id in (
              select s.organization_id from public.fn_conversation_scope() s where s.sees_unassigned
            )
       )
  );

drop policy if exists "messages_select" on public.messages;
create policy "messages_select" on public.messages
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
    )
  );

drop policy if exists "tenant_isolation_contacts_read" on public.contacts;
create policy "tenant_isolation_contacts_read" on public.contacts
  for select to authenticated
  using (
    organization_id in (select public.fn_user_org_ids())
    or public.fn_is_platform_admin()
  );

-- FOR ALL inclui SELECT. Sem TO, oauth_delegado avaliava fn_user_org_ids e
-- morria (ou, se tivesse EXECUTE, via o pessoal). Parte em insert/update/delete.
drop policy if exists "tenant_isolation_contacts_write" on public.contacts;
drop policy if exists "tenant_isolation_contacts_write_insert" on public.contacts;
drop policy if exists "tenant_isolation_contacts_write_update" on public.contacts;
drop policy if exists "tenant_isolation_contacts_write_delete" on public.contacts;
create policy "tenant_isolation_contacts_write_insert" on public.contacts
  for insert to authenticated
  with check (
    organization_id in (select public.fn_user_org_ids())
    or public.fn_is_platform_admin_full()
  );
create policy "tenant_isolation_contacts_write_update" on public.contacts
  for update to authenticated
  using (
    organization_id in (select public.fn_user_org_ids())
    or public.fn_is_platform_admin_full()
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    or public.fn_is_platform_admin_full()
  );
create policy "tenant_isolation_contacts_write_delete" on public.contacts
  for delete to authenticated
  using (
    organization_id in (select public.fn_user_org_ids())
    or public.fn_is_platform_admin_full()
  );

drop policy if exists tenant_isolation_locacao_processo_conversas_select
  on public.locacao_processo_conversas;
create policy tenant_isolation_locacao_processo_conversas_select
  on public.locacao_processo_conversas
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists tenant_isolation_locacao_processo_documentos_select
  on public.locacao_processo_documentos;
create policy tenant_isolation_locacao_processo_documentos_select
  on public.locacao_processo_documentos
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));

-- Policies TO oauth_delegado. Cookie permanece authenticated (USING intacto).
grant select on public.contacts to oauth_delegado;
grant select on public.conversations to oauth_delegado;
grant select on public.messages to oauth_delegado;
grant select on public.locacao_processo_conversas to oauth_delegado;
grant select on public.locacao_processo_documentos to oauth_delegado;

drop policy if exists contacts_select_oauth_delegado on public.contacts;
create policy contacts_select_oauth_delegado
  on public.contacts
  as permissive
  for select
  to oauth_delegado
  using (
    is_personal is false
    and public.fn_delegacao_grant_vivo(organization_id)
  );

drop policy if exists conversations_select_oauth_delegado on public.conversations;
create policy conversations_select_oauth_delegado
  on public.conversations
  as permissive
  for select
  to oauth_delegado
  using (
    contact_id is not null
    and public.fn_delegacao_grant_vivo(organization_id)
    and exists (
      select 1
        from public.contacts ct
       where ct.id = conversations.contact_id
         and ct.organization_id = conversations.organization_id
         and ct.is_personal is false
    )
  );

drop policy if exists messages_select_oauth_delegado on public.messages;
create policy messages_select_oauth_delegado
  on public.messages
  as permissive
  for select
  to oauth_delegado
  using (
    public.fn_delegacao_grant_vivo(organization_id)
    and exists (
      select 1
        from public.conversations c
        join public.contacts ct
          on ct.id = c.contact_id
         and ct.organization_id = c.organization_id
       where c.id = messages.conversation_id
         and c.organization_id = messages.organization_id
         and ct.is_personal is false
    )
  );

drop policy if exists locacao_processo_conversas_select_oauth_delegado
  on public.locacao_processo_conversas;
create policy locacao_processo_conversas_select_oauth_delegado
  on public.locacao_processo_conversas
  as permissive
  for select
  to oauth_delegado
  using (
    public.fn_delegacao_grant_vivo(organization_id)
    and exists (
      select 1
        from public.conversations c
        join public.contacts ct
          on ct.id = c.contact_id
         and ct.organization_id = c.organization_id
       where c.id = locacao_processo_conversas.conversation_id
         and c.organization_id = locacao_processo_conversas.organization_id
         and ct.is_personal is false
    )
  );

drop policy if exists locacao_processo_documentos_select_oauth_delegado
  on public.locacao_processo_documentos;
create policy locacao_processo_documentos_select_oauth_delegado
  on public.locacao_processo_documentos
  as permissive
  for select
  to oauth_delegado
  using (
    public.fn_delegacao_grant_vivo(organization_id)
    and exists (
      select 1
        from public.locacao_processo_conversas lpc
        join public.conversations c
          on c.id = lpc.conversation_id
         and c.organization_id = lpc.organization_id
        join public.contacts ct
          on ct.id = c.contact_id
         and ct.organization_id = c.organization_id
       where lpc.processo_id = locacao_processo_documentos.processo_id
         and lpc.organization_id = locacao_processo_documentos.organization_id
         and ct.is_personal is false
    )
  );

-- Storage: ligar RLS (no stub do CI as policies existiam inertes) e recortar
-- policies sem TO — sem isso elas passam a valer para oauth_delegado.
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'alter table storage.objects enable row level security';
    execute 'grant usage on schema storage to oauth_delegado';
    execute 'revoke all on storage.objects from oauth_delegado';
    execute 'grant select on storage.objects to oauth_delegado';
  end if;
end
$$;

drop policy if exists "tenant_read_ai_policy" on storage.objects;
create policy "tenant_read_ai_policy" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ai-policy'
    and exists (
      select 1 from public.user_organizations uo
      where uo.user_id = auth.uid()
        and uo.revoked_at is null
        and uo.organization_id = (split_part(name, '/', 1))::uuid
    )
  );

drop policy if exists "tenant_write_ai_policy" on storage.objects;
create policy "tenant_write_ai_policy" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ai-policy'
    and exists (
      select 1 from public.user_organizations uo
      where uo.user_id = auth.uid()
        and uo.revoked_at is null
        and uo.organization_id = (split_part(name, '/', 1))::uuid
    )
  );

drop policy if exists "tenant_delete_ai_policy" on storage.objects;
create policy "tenant_delete_ai_policy" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'ai-policy'
    and exists (
      select 1 from public.user_organizations uo
      where uo.user_id = auth.uid()
        and uo.revoked_at is null
        and uo.organization_id = (split_part(name, '/', 1))::uuid
    )
  );

drop policy if exists "tenant_read_lgpd_exports" on storage.objects;
create policy "tenant_read_lgpd_exports" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'lgpd-exports'
    and exists (
      select 1 from public.user_organizations uo
      where uo.user_id = auth.uid()
        and uo.revoked_at is null
        and uo.organization_id = (split_part(name, '/', 1))::uuid
    )
  );

drop policy if exists "propostas: leitura por organizacao" on storage.objects;
create policy "propostas: leitura por organizacao" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'propostas'
    and (split_part(name, '/', 1))::uuid in (select public.fn_user_org_ids())
  );

drop policy if exists "locacao-processos: leitura por organizacao" on storage.objects;
create policy "locacao-processos: leitura por organizacao" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'locacao-processos'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    and (split_part(name, '/', 1))::uuid in (select public.fn_user_org_ids())
  );

drop policy if exists storage_objects_select_oauth_delegado on storage.objects;
create policy storage_objects_select_oauth_delegado
  on storage.objects
  as permissive
  for select
  to oauth_delegado
  using (
    name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    and (
      (
        bucket_id = 'whatsapp-media'
        and public.fn_delegacao_grant_vivo((split_part(name, '/', 1))::uuid)
        and exists (
          select 1
            from public.messages m
            join public.conversations c
              on c.id = m.conversation_id
             and c.organization_id = m.organization_id
            join public.contacts ct
              on ct.id = c.contact_id
             and ct.organization_id = c.organization_id
           where m.media_storage_path = storage.objects.name
             and m.organization_id = (split_part(storage.objects.name, '/', 1))::uuid
             and ct.is_personal is false
        )
      )
      or (
        bucket_id = 'locacao-processos'
        and public.fn_delegacao_grant_vivo((split_part(name, '/', 1))::uuid)
        and exists (
          select 1
            from public.locacao_processo_documentos d
            join public.locacao_processo_conversas lpc
              on lpc.processo_id = d.processo_id
             and lpc.organization_id = d.organization_id
            join public.conversations c
              on c.id = lpc.conversation_id
             and c.organization_id = lpc.organization_id
            join public.contacts ct
              on ct.id = c.contact_id
             and ct.organization_id = c.organization_id
           where d.storage_path = storage.objects.name
             and d.organization_id = (split_part(storage.objects.name, '/', 1))::uuid
             and ct.is_personal is false
        )
      )
    )
  );

-- Corta EXECUTE herdado de PUBLIC e TRUNCATE em qualquer tabela. NÃO pinta
-- policy global. Cookie/authenticated não entram neste laço.
do $$
declare
  r record;
begin
  for r in
    select n.nspname as nsp, c.relname as rel
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'storage')
       and c.relkind in ('r', 'p', 'v', 'm', 'S')
  loop
    execute format('revoke all on %I.%I from oauth_delegado', r.nsp, r.rel);
  end loop;

  for r in
    select n.nspname as nsp, p.proname as nome, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
  loop
    begin
      execute format(
        'revoke all on function %I.%I(%s) from oauth_delegado',
        r.nsp, r.nome, r.args
      );
    exception when others then
      null;
    end;
  end loop;
end
$$;

grant execute on function auth.uid() to oauth_delegado;
grant execute on function auth.jwt() to oauth_delegado;

-- Devolve só o mínimo depois do REVOKE amplo.
grant select on public.delegacao_visibilidade_corporativa to oauth_delegado;
grant select on public.contacts to oauth_delegado;
grant select on public.conversations to oauth_delegado;
grant select on public.messages to oauth_delegado;
grant select on public.locacao_processo_conversas to oauth_delegado;
grant select on public.locacao_processo_documentos to oauth_delegado;
grant execute on function public.fn_delegacao_grant_vivo(uuid) to oauth_delegado;
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'grant select on storage.objects to oauth_delegado';
  end if;
end
$$;

alter default privileges for role postgres in schema public
  revoke all on tables from oauth_delegado;
alter default privileges for role postgres in schema public
  revoke all on functions from oauth_delegado;
alter default privileges for role postgres in schema public
  revoke all on sequences from oauth_delegado;

notify pgrst, 'reload schema';
