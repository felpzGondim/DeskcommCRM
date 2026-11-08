-- manifest: Fonte revisável da delegação corporativa (preparar, não ativar): coluna channel_sessions.classificacao_empresarial (NULL recusa), tabela delegacao_visibilidade_corporativa (grant por usuário+client OAuth, SELECT só do próprio uid, escrita só service_role) e policy extra conversations_select_delegacao_oauth. conversations_select de cookie exige client_id IS NULL para não herdar Inbox em token OAuth. Sem SECURITY DEFINER nova, sem user_metadata, sem linha semeada. Rollback: as estruturas ficam; a superfície HTTP segue 404.

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

notify pgrst, 'reload schema';
