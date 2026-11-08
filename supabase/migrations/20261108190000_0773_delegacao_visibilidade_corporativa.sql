-- manifest: Fonte revisável da delegação corporativa (preparar, não ativar): coluna channel_sessions.classificacao_empresarial (NULL recusa), tabela delegacao_visibilidade_corporativa (grant por usuário+client OAuth, SELECT só do próprio uid, escrita só service_role), policy extra conversations_select_delegacao_oauth e messages_select restritiva OAuth. Cookie exige client_id IS NULL em SELECT/escrita de conversations e escrita de messages. Sem função nova, sem metadado de perfil, sem linha semeada. Rollback: as estruturas ficam; a superfície HTTP segue 404.

-- ---- delegação visibilidade corporativa (migration 0773, fork) ----
-- Preparação offline. Nenhuma instalação liga OAuth, grava grant ou classifica
-- sessão por este arquivo. Felipe aprova grants/ativação depois.

alter table public.channel_sessions
  add column if not exists classificacao_empresarial text;

alter table public.channel_sessions
  drop constraint if exists channel_sessions_classificacao_empresarial_check;
alter table public.channel_sessions
  add constraint channel_sessions_classificacao_empresarial_check
  check (
    classificacao_empresarial is null
    or classificacao_empresarial in ('corporativa', 'pessoal')
  );

comment on column public.channel_sessions.classificacao_empresarial is
  'corporativa | pessoal | NULL (desconhecida). A superfície delegada recusa NULL e pessoal. A Inbox por cookie não usa esta coluna.';

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

create unique index if not exists delegacao_visibilidade_corporativa_ativa_uidx
  on public.delegacao_visibilidade_corporativa (user_id, oauth_client_id)
  where revoked_at is null;

create index if not exists delegacao_visibilidade_corporativa_org_user_idx
  on public.delegacao_visibilidade_corporativa (organization_id, user_id);

comment on table public.delegacao_visibilidade_corporativa is
  'Grant auditável da leitura corporativa delegada. Linha viva + token OAuth (client_id) habilitam a policy extra de conversations. Sem linha = recusa. JWT exp não revoga sozinho. Nenhuma linha nasce com o schema.';

alter table public.delegacao_visibilidade_corporativa enable row level security;

drop policy if exists delegacao_visibilidade_corporativa_select on public.delegacao_visibilidade_corporativa;
create policy delegacao_visibilidade_corporativa_select
  on public.delegacao_visibilidade_corporativa
  for select
  using (
    user_id = auth.uid()
    and organization_id in (select public.fn_user_org_ids())
  );

revoke all on public.delegacao_visibilidade_corporativa from public, anon, authenticated;
grant select on public.delegacao_visibilidade_corporativa to authenticated;
grant all on public.delegacao_visibilidade_corporativa to service_role;

-- Cookie / sessão GoTrue (client_id nulo): a Inbox segue a escada de 0726.
-- Token OAuth (client_id presente) NÃO herda essa policy — evita dono/admin
-- com OAuth ver sessão pessoal sem grant + classificação.
drop policy if exists "conversations_select" on public.conversations;
create policy "conversations_select" on public.conversations
  for select using (
    (auth.jwt() ->> 'client_id') is null
    and (
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
    )
  );

drop policy if exists conversations_select_delegacao_oauth on public.conversations;
create policy conversations_select_delegacao_oauth on public.conversations
  for select using (
    (auth.jwt() ->> 'client_id') is not null
    and (auth.jwt() ->> 'client_id') <> ''
    and exists (
      select 1
      from public.delegacao_visibilidade_corporativa g
      where g.user_id = auth.uid()
        and g.organization_id = conversations.organization_id
        and g.oauth_client_id = (auth.jwt() ->> 'client_id')
        and g.revoked_at is null
        and g.expires_at > now()
        and g.efeitos && array['buscar','ler','baixar']::text[]
    )
    and exists (
      select 1
      from public.channel_sessions cs
      where cs.id = conversations.channel_session_id
        and cs.organization_id = conversations.organization_id
        and cs.classificacao_empresarial = 'corporativa'
    )
    and exists (
      select 1
      from public.contacts ct
      where ct.id = conversations.contact_id
        and ct.organization_id = conversations.organization_id
        and ct.is_personal is false
    )
  );

-- Escritas da Inbox: só sessão cookie (client_id nulo). Token OAuth não é
-- veículo de insert/update/delete — a superfície delegada é só buscar/ler/baixar.
drop policy if exists "conversations_agent_insert" on public.conversations;
create policy "conversations_agent_insert" on public.conversations
  for insert with check (
    (auth.jwt() ->> 'client_id') is null
    and (
      public.fn_is_platform_admin_full()
      or ((organization_id in (select public.fn_user_org_ids()))
          and public.fn_role_at_least(organization_id, 'agent'))
    )
  );
drop policy if exists "conversations_agent_update" on public.conversations;
create policy "conversations_agent_update" on public.conversations
  for update using (
    (auth.jwt() ->> 'client_id') is null
    and (
      public.fn_is_platform_admin_full()
      or ((organization_id in (select public.fn_user_org_ids()))
          and public.fn_role_at_least(organization_id, 'agent'))
    )
  ) with check (
    (auth.jwt() ->> 'client_id') is null
    and (
      public.fn_is_platform_admin_full()
      or ((organization_id in (select public.fn_user_org_ids()))
          and public.fn_role_at_least(organization_id, 'agent'))
    )
  );
drop policy if exists "conversations_agent_delete" on public.conversations;
create policy "conversations_agent_delete" on public.conversations
  for delete using (
    (auth.jwt() ->> 'client_id') is null
    and (
      public.fn_is_platform_admin_full()
      or ((organization_id in (select public.fn_user_org_ids()))
          and public.fn_role_at_least(organization_id, 'agent'))
    )
  );

drop policy if exists "messages_insert" on public.messages;
create policy "messages_insert" on public.messages
  for insert with check (
    (auth.jwt() ->> 'client_id') is null
    and (
      (organization_id in (select public.fn_user_org_ids()))
      or public.fn_is_platform_admin_full()
    )
  );
drop policy if exists "messages_update" on public.messages;
create policy "messages_update" on public.messages
  for update using (
    (auth.jwt() ->> 'client_id') is null
    and (
      (organization_id in (select public.fn_user_org_ids()))
      or public.fn_is_platform_admin_full()
    )
  ) with check (
    (auth.jwt() ->> 'client_id') is null
    and (
      (organization_id in (select public.fn_user_org_ids()))
      or public.fn_is_platform_admin_full()
    )
  );
drop policy if exists "messages_delete" on public.messages;
create policy "messages_delete" on public.messages
  for delete using (
    (auth.jwt() ->> 'client_id') is null
    and (
      (organization_id in (select public.fn_user_org_ids()))
      or public.fn_is_platform_admin_full()
    )
  );

-- messages_select (0035) é permissiva: platform_admin OR exists(conversations).
-- Políticas permissivas OR-am. Token OAuth não pode herdar mensagem de conversa
-- pessoal/unknown/outra-org só porque o EXISTS enxerga a linha. Restritiva AND
-- com a permissiva: cookie (client_id nulo) inalterado; OAuth exige o mesmo
-- recorte da policy extra (grant vivo + sessão corporativa + is_personal false).
drop policy if exists messages_select_delegacao_oauth on public.messages;
create policy messages_select_delegacao_oauth on public.messages
  as restrictive
  for select
  using (
    (auth.jwt() ->> 'client_id') is null
    or (
      exists (
        select 1
        from public.delegacao_visibilidade_corporativa g
        where g.user_id = auth.uid()
          and g.organization_id = messages.organization_id
          and g.oauth_client_id = (auth.jwt() ->> 'client_id')
          and g.revoked_at is null
          and g.expires_at > now()
          and g.efeitos && array['buscar','ler','baixar']::text[]
      )
      and exists (
        select 1
        from public.conversations c
        join public.channel_sessions cs
          on cs.id = c.channel_session_id
         and cs.organization_id = c.organization_id
        join public.contacts ct
          on ct.id = c.contact_id
         and ct.organization_id = c.organization_id
        where c.id = messages.conversation_id
          and c.organization_id = messages.organization_id
          and cs.classificacao_empresarial = 'corporativa'
          and ct.is_personal is false
      )
    )
  );

notify pgrst, 'reload schema';
