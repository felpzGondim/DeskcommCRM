-- manifest: Papel Postgres oauth_delegado (NOINHERIT) para leitura corporativa delegada: CREATE ROLE, GRANT ao authenticator, hook versionado por client_id autorizado, tabelas de client/grant/conta empresarial/vínculo de sessão sem semente, policies TO o papel só em conversas/mensagens/contatos/documentos/storage corporativos, origem empresarial = vínculo sessão→conta empresarial (vazia/desconhecida/pessoal recusa; is_personal=false não basta; inclusão/substituição herda pelo mesmo conta_id), REVOKE de PUBLIC/EXECUTE/TRUNCATE no papel. Cookie/authenticated intocado. Sem policy global experimental. Sem ativar o hook no Auth da instalação.
--
-- Inbox por cookie não muda. Superfície HTTP/MCP vive no app, não neste SQL.
-- O hook SQL existe; ligá-lo no Auth (GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN) é config
-- da instalação, não deste arquivo. Nenhuma linha de grant/client/sessão nasce
-- com o schema. WORKING/STOPPED/created_by/display_name/org NÃO autorizam origem.

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

-- A 0563 acrescenta contacts.is_personal no apêndice DEPOIS da varredura.
-- Este bloco (funções SQL + policies) precisa da coluna aqui: ADD IF NOT EXISTS
-- é no-op no update (0563 já rodou) e cria no install quando o baseline chega
-- neste ponto antes da 0563.
alter table public.contacts
  add column if not exists is_personal boolean default false not null;

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

-- Origem empresarial autoritativa: VÍNCULO da sessão de canal com a CONTA
-- empresarial da organização (WhatsApp é FONTE de documento, não o canal Bot).
-- Permissão de leitura delegada é no grant individual (uid+client+org) sobre a
-- conta; números atuais/futuros/substituídos HERDAM se o cadastro administrativo
-- da conexão classificar a sessão nessa conta. NÃO é lista fixa de telefone.
-- channel_sessions NÃO tem coluna empresarial/pessoal. organization_id, status
-- WORKING, created_by e display_name NÃO classificam. Sessão nova sem vínculo =
-- desconhecida = recusa. Pessoal nunca herda. Sem semente.
create table if not exists public.delegacao_contas_empresariais (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

comment on table public.delegacao_contas_empresariais is
  'Conta empresarial da org. Grant individual lê o que estiver vinculado a ela. Sem telefone, sem PII, sem semente.';

alter table public.delegacao_contas_empresariais enable row level security;
revoke all on public.delegacao_contas_empresariais from public, anon, authenticated, oauth_delegado;
grant select on public.delegacao_contas_empresariais to oauth_delegado;
grant all on public.delegacao_contas_empresariais to service_role;

drop policy if exists delegacao_contas_empresariais_select on public.delegacao_contas_empresariais;
create policy delegacao_contas_empresariais_select
  on public.delegacao_contas_empresariais
  as permissive
  for select
  to oauth_delegado
  using (
    revoked_at is null
    and public.fn_delegacao_grant_vivo(organization_id)
  );

drop table if exists public.delegacao_sessoes_empresariais;
create table public.delegacao_sessoes_empresariais (
  channel_session_id uuid primary key references public.channel_sessions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conta_empresarial_id uuid not null references public.delegacao_contas_empresariais(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists delegacao_sessoes_empresariais_org_idx
  on public.delegacao_sessoes_empresariais (organization_id)
  where revoked_at is null;

create index if not exists delegacao_sessoes_empresariais_conta_idx
  on public.delegacao_sessoes_empresariais (conta_empresarial_id)
  where revoked_at is null;

comment on table public.delegacao_sessoes_empresariais is
  'Vínculo sessão→conta empresarial, gravado no cadastro administrativo da conexão. Não é lista de telefone. Vazio/revogado = recusa. Sem PII.';

alter table public.delegacao_sessoes_empresariais enable row level security;

revoke all on public.delegacao_sessoes_empresariais from public, anon, authenticated, oauth_delegado;
grant select on public.delegacao_sessoes_empresariais to oauth_delegado;
grant all on public.delegacao_sessoes_empresariais to service_role;

drop policy if exists delegacao_sessoes_empresariais_select on public.delegacao_sessoes_empresariais;
create policy delegacao_sessoes_empresariais_select
  on public.delegacao_sessoes_empresariais
  as permissive
  for select
  to oauth_delegado
  using (
    revoked_at is null
    and public.fn_delegacao_grant_vivo(organization_id)
  );

-- DEFINER estável: sessão vinculada a conta viva da mesma org. Não lê telefone.
create or replace function public.fn_delegacao_sessao_empresarial(p_session uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_session is not null
    and p_org is not null
    and exists (
      select 1
        from public.delegacao_sessoes_empresariais s
        join public.delegacao_contas_empresariais a
          on a.id = s.conta_empresarial_id
         and a.organization_id = s.organization_id
        join public.channel_sessions cs
          on cs.id = s.channel_session_id
         and cs.organization_id = s.organization_id
       where s.channel_session_id = p_session
         and s.organization_id = p_org
         and s.revoked_at is null
         and a.revoked_at is null
    );
$$;

revoke all on function public.fn_delegacao_sessao_empresarial(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_delegacao_sessao_empresarial(uuid, uuid) to oauth_delegado;

comment on function public.fn_delegacao_sessao_empresarial(uuid, uuid) is
  'Origem empresarial: sessão vinculada a conta viva da org. Substituição herda pelo mesmo conta_id. Pessoal/unknown (sem vínculo) = false. Não olha status/created_by/nome/telefone.';

-- DEFINER: lê contacts.is_personal sem RLS, para as policies de conversa
-- não recursarem com a policy de contacts (que EXISTS conversations).
create or replace function public.fn_delegacao_contato_corporativo(p_contact uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_contact is not null
    and p_org is not null
    and exists (
      select 1
        from public.contacts ct
       where ct.id = p_contact
         and ct.organization_id = p_org
         and ct.is_personal is false
    );
$$;

revoke all on function public.fn_delegacao_contato_corporativo(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_delegacao_contato_corporativo(uuid, uuid) to oauth_delegado;

comment on function public.fn_delegacao_contato_corporativo(uuid, uuid) is
  'Contato da org com is_personal is false. DEFINER para não recursar RLS contacts↔conversations.';

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
  'Custom Access Token Hook (v1): allowlist VAZIA (zero linhas vivas) = copia claims, role permanece authenticated; NÃO-VAZIA = client_id vivo vira oauth_delegado. Ligar o hook no Auth não desfaz recast de policies nem RLS de storage. Ligar no Auth é config, não este SQL.';

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
create policy "tenant_isolation_contacts_read" on public.contacts for select to authenticated using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

-- FOR ALL inclui SELECT. Sem TO, oauth_delegado avaliava fn_user_org_ids e
-- morria (ou, se tivesse EXECUTE, via o pessoal). Parte em insert/update/delete.
drop policy if exists "tenant_isolation_contacts_write" on public.contacts;
drop policy if exists "tenant_isolation_contacts_write_insert" on public.contacts;
drop policy if exists "tenant_isolation_contacts_write_update" on public.contacts;
drop policy if exists "tenant_isolation_contacts_write_delete" on public.contacts;
create policy "tenant_isolation_contacts_write_insert" on public.contacts for insert to authenticated with check (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin_full());
create policy "tenant_isolation_contacts_write_update" on public.contacts for update to authenticated using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin_full()) with check (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin_full());
create policy "tenant_isolation_contacts_write_delete" on public.contacts for delete to authenticated using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin_full());

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
    and exists (
      select 1
        from public.conversations c
       where c.contact_id = contacts.id
         and c.organization_id = contacts.organization_id
         and public.fn_delegacao_sessao_empresarial(c.channel_session_id, c.organization_id)
    )
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
    and public.fn_delegacao_sessao_empresarial(channel_session_id, organization_id)
    and public.fn_delegacao_contato_corporativo(contact_id, organization_id)
  );

drop policy if exists messages_select_oauth_delegado on public.messages;
create policy messages_select_oauth_delegado
  on public.messages
  as permissive
  for select
  to oauth_delegado
  using (
    public.fn_delegacao_grant_vivo(organization_id)
    and public.fn_delegacao_sessao_empresarial(channel_session_id, organization_id)
    and exists (
      select 1
        from public.conversations c
       where c.id = messages.conversation_id
         and c.organization_id = messages.organization_id
         and public.fn_delegacao_contato_corporativo(c.contact_id, c.organization_id)
         and public.fn_delegacao_sessao_empresarial(c.channel_session_id, c.organization_id)
    )
  );

drop policy if exists locacao_processo_conversas_select_oauth_delegado on public.locacao_processo_conversas;
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
       where c.id = locacao_processo_conversas.conversation_id
         and c.organization_id = locacao_processo_conversas.organization_id
         and public.fn_delegacao_contato_corporativo(c.contact_id, c.organization_id)
         and public.fn_delegacao_sessao_empresarial(c.channel_session_id, c.organization_id)
    )
  );

drop policy if exists locacao_processo_documentos_select_oauth_delegado on public.locacao_processo_documentos;
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
       where lpc.processo_id = locacao_processo_documentos.processo_id
         and lpc.organization_id = locacao_processo_documentos.organization_id
         and public.fn_delegacao_contato_corporativo(c.contact_id, c.organization_id)
         and public.fn_delegacao_sessao_empresarial(c.channel_session_id, c.organization_id)
    )
  );

-- Storage: ligar RLS (no stub do CI as policies existiam inertes) e recortar
-- policies sem TO — sem isso elas passam a valer para oauth_delegado.
-- Gate: RLS já ON → não ALTER (não-dono). RLS OFF → ENABLE; se continuar OFF
-- (42501 de não-dono) ABORTA antes de GRANT SELECT. Swallow de 42501 + GRANT
-- com RLS off entregaria o bucket inteiro ao papel.
do $$
declare
  rls_ligada boolean;
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  select c.relrowsecurity into rls_ligada
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'storage' and c.relname = 'objects';
  if rls_ligada is not true then
    begin
      execute 'alter table storage.objects enable row level security';
    exception
      when insufficient_privilege then
        raise exception
          'delegacao 0774: storage.objects com RLS off e sem privilégio para ENABLE — abortar antes de GRANT SELECT a oauth_delegado'
          using errcode = '42501';
    end;
    select c.relrowsecurity into rls_ligada
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'storage' and c.relname = 'objects';
    if rls_ligada is not true then
      raise exception
        'delegacao 0774: storage.objects permanece com RLS off após ENABLE — abortar antes de GRANT SELECT a oauth_delegado';
    end if;
  end if;
  begin
    execute 'grant usage on schema storage to oauth_delegado';
    execute 'revoke all on storage.objects from oauth_delegado';
    execute 'grant select on storage.objects to oauth_delegado';
  exception
    when insufficient_privilege then null;
  end;
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
           where m.media_storage_path = storage.objects.name
             and m.organization_id = (split_part(storage.objects.name, '/', 1))::uuid
             and public.fn_delegacao_contato_corporativo(c.contact_id, c.organization_id)
             and public.fn_delegacao_sessao_empresarial(m.channel_session_id, m.organization_id)
             and public.fn_delegacao_sessao_empresarial(c.channel_session_id, c.organization_id)
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
           where d.storage_path = storage.objects.name
             and d.organization_id = (split_part(storage.objects.name, '/', 1))::uuid
             and public.fn_delegacao_contato_corporativo(c.contact_id, c.organization_id)
             and public.fn_delegacao_sessao_empresarial(c.channel_session_id, c.organization_id)
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

do $$
begin
  begin
    execute 'grant execute on function auth.uid() to oauth_delegado';
  exception
    when insufficient_privilege then null;
  end;
  begin
    execute 'grant execute on function auth.jwt() to oauth_delegado';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

-- Devolve só o mínimo depois do REVOKE amplo.
grant select on public.delegacao_visibilidade_corporativa to oauth_delegado;
grant select on public.delegacao_contas_empresariais to oauth_delegado;
grant select on public.delegacao_sessoes_empresariais to oauth_delegado;
grant execute on function public.fn_delegacao_sessao_empresarial(uuid, uuid) to oauth_delegado;
grant execute on function public.fn_delegacao_contato_corporativo(uuid, uuid) to oauth_delegado;
grant select on public.contacts to oauth_delegado;
grant select on public.conversations to oauth_delegado;
grant select on public.messages to oauth_delegado;
grant select on public.locacao_processo_conversas to oauth_delegado;
grant select on public.locacao_processo_documentos to oauth_delegado;
grant execute on function public.fn_delegacao_grant_vivo(uuid) to oauth_delegado;
-- pgrst.db_pre_request corre como o papel do JWT. Sem EXECUTE a cadeia HTTP
-- morre em 42501 antes da RLS — não amplia dado, só deixa a guarda de replay
-- (0250) rodar no mesmo papel que já roda para cookie.
grant execute on function public.fn_pgrst_recusar_replay_do_gateway() to oauth_delegado;
do $$
declare
  rls_ligada boolean;
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  select c.relrowsecurity into rls_ligada
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'storage' and c.relname = 'objects';
  if rls_ligada is not true then
    raise exception
      'delegacao 0774: GRANT SELECT em storage.objects recusado — RLS off'
      using errcode = '42501';
  end if;
  begin
    execute 'grant select on storage.objects to oauth_delegado';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

alter default privileges for role postgres in schema public
  revoke all on tables from oauth_delegado;
alter default privileges for role postgres in schema public
  revoke all on functions from oauth_delegado;
alter default privileges for role postgres in schema public
  revoke all on sequences from oauth_delegado;

notify pgrst, 'reload schema';
