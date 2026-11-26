-- manifest: Autoriza o efeito enviar no grant delegado e a leitura de uma sessão titular vinculada, mantendo oauth_delegado somente leitura.
--
-- O baseline reaplica este bloco em cada update. Vínculos e grants operacionais
-- sobrevivem à reaplicação. O hook e o consentimento OAuth seguem na 0774.

alter table public.delegacao_visibilidade_corporativa
  drop constraint if exists delegacao_visibilidade_corporativa_efeitos_check;
alter table public.delegacao_visibilidade_corporativa
  add constraint delegacao_visibilidade_corporativa_efeitos_check
  check (efeitos <> '{}'::text[] and efeitos <@ array['buscar','ler','baixar','enviar']::text[]);

create table if not exists public.delegacao_sessoes_titular (
  channel_session_id uuid primary key references public.channel_sessions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz
);

create unique index if not exists delegacao_sessoes_titular_user_vivo_uidx
  on public.delegacao_sessoes_titular (user_id) where revoked_at is null;

alter table public.delegacao_sessoes_titular enable row level security;
revoke all on public.delegacao_sessoes_titular from public, anon, authenticated, oauth_delegado;
grant all on public.delegacao_sessoes_titular to service_role;
grant select on public.delegacao_sessoes_titular to oauth_delegado;

-- Ambos os cadastros usam a mesma trava de sessão. Sem a trava e a verificação
-- nas duas direções, dois operadores poderiam cadastrar as duas origens juntas.
create or replace function public.fn_delegacao_validar_origem_sessao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Revogar precisa funcionar mesmo depois de a membership ou a conta acabar.
  if tg_op = 'UPDATE' and new.revoked_at is not null
     and new.channel_session_id = old.channel_session_id and new.organization_id = old.organization_id
     and (tg_table_name = 'delegacao_sessoes_empresariais'
          or (to_jsonb(new) ->> 'user_id') = (to_jsonb(old) ->> 'user_id')) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.channel_session_id::text, 775));
  if tg_table_name = 'delegacao_sessoes_empresariais' then
    if new.revoked_at is null and exists (
      select 1 from public.delegacao_sessoes_titular t
      where t.channel_session_id = new.channel_session_id and t.revoked_at is null
    ) then
      raise exception 'A sessão já tem vínculo titular ativo.' using errcode = '23514';
    end if;
    return new;
  end if;

  if not exists (
    select 1 from public.channel_sessions s
    where s.id = new.channel_session_id and s.organization_id = new.organization_id
  ) then
    raise exception 'A sessão não pertence à organização do vínculo titular.' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.user_organizations u
    where u.organization_id = new.organization_id and u.user_id = new.user_id
      and u.revoked_at is null and u.role in ('owner', 'admin')
  ) then
    raise exception 'O vínculo titular exige membership ativa owner ou admin.' using errcode = '23514';
  end if;
  if new.revoked_at is null and exists (
    select 1 from public.delegacao_sessoes_empresariais e
    where e.channel_session_id = new.channel_session_id and e.revoked_at is null
  ) then
    raise exception 'A sessão já tem vínculo empresarial ativo.' using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function public.fn_delegacao_validar_origem_sessao() from public, anon, authenticated, oauth_delegado;
grant execute on function public.fn_delegacao_validar_origem_sessao() to service_role;

drop trigger if exists delegacao_sessao_titular_validar on public.delegacao_sessoes_titular;
create trigger delegacao_sessao_titular_validar before insert or update on public.delegacao_sessoes_titular
  for each row execute function public.fn_delegacao_validar_origem_sessao();
drop trigger if exists delegacao_sessao_empresarial_validar on public.delegacao_sessoes_empresariais;
create trigger delegacao_sessao_empresarial_validar before insert or update on public.delegacao_sessoes_empresariais
  for each row execute function public.fn_delegacao_validar_origem_sessao();

create or replace function public.fn_delegacao_sessao_titular(p_session uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.delegacao_sessoes_titular t
    join public.channel_sessions cs on cs.id = t.channel_session_id and cs.organization_id = t.organization_id
    join public.user_organizations u on u.organization_id = t.organization_id and u.user_id = t.user_id
    where t.channel_session_id = p_session and t.organization_id = p_org
      and t.user_id = nullif(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', ''
      )::uuid
      and t.revoked_at is null and u.revoked_at is null and u.role in ('owner', 'admin')
  );
$$;

create or replace function public.fn_delegacao_sessao_autorizada(p_session uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.fn_delegacao_sessao_empresarial(p_session, p_org)
      or public.fn_delegacao_sessao_titular(p_session, p_org);
$$;

revoke all on function public.fn_delegacao_sessao_titular(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fn_delegacao_sessao_autorizada(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_delegacao_sessao_titular(uuid, uuid) to oauth_delegado;
grant execute on function public.fn_delegacao_sessao_autorizada(uuid, uuid) to oauth_delegado;

drop policy if exists delegacao_sessoes_titular_select on public.delegacao_sessoes_titular;
create policy delegacao_sessoes_titular_select on public.delegacao_sessoes_titular
  for select to oauth_delegado
  using (
    revoked_at is null
    and public.fn_delegacao_grant_vivo(organization_id)
    and public.fn_delegacao_sessao_titular(channel_session_id, organization_id)
  );

-- A superfície precisa descobrir a org e o estado de uma sessão antes do
-- cliente privilegiado. A RPC projeta só o cadastro necessário, com as mesmas
-- conferências das policies. SELECT em channel_sessions exporia credenciais.
create or replace function public.fn_delegacao_listar_sessoes(p_session uuid default null)
returns table (channel_session_id uuid, organization_id uuid, origem text, status text)
language sql
stable
security definer
set search_path = public
as $$
  with vinculos as (
    select e.channel_session_id, e.organization_id, 'empresarial'::text as origem
      from public.delegacao_sessoes_empresariais e
     where e.revoked_at is null
       and (p_session is null or e.channel_session_id = p_session)
       and public.fn_delegacao_sessao_empresarial(e.channel_session_id, e.organization_id)
    union all
    select t.channel_session_id, t.organization_id, 'titular'::text
      from public.delegacao_sessoes_titular t
     where t.revoked_at is null
       and (p_session is null or t.channel_session_id = p_session)
       and public.fn_delegacao_sessao_titular(t.channel_session_id, t.organization_id)
  )
  select v.channel_session_id, v.organization_id, v.origem, s.status::text
    from vinculos v
    join public.channel_sessions s on s.id = v.channel_session_id and s.organization_id = v.organization_id
   where public.fn_delegacao_grant_vivo(v.organization_id);
$$;

revoke all on function public.fn_delegacao_listar_sessoes(uuid) from public, anon, authenticated;
grant execute on function public.fn_delegacao_listar_sessoes(uuid) to oauth_delegado;

-- Policies dedicadas da 0774. Só a classificação de sessão é ampliada.
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
         and public.fn_delegacao_sessao_autorizada(c.channel_session_id, c.organization_id)
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
    and public.fn_delegacao_sessao_autorizada(channel_session_id, organization_id)
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
    and public.fn_delegacao_sessao_autorizada(channel_session_id, organization_id)
    and exists (
      select 1
        from public.conversations c
       where c.id = messages.conversation_id
         and c.organization_id = messages.organization_id
         and public.fn_delegacao_contato_corporativo(c.contact_id, c.organization_id)
         and public.fn_delegacao_sessao_autorizada(c.channel_session_id, c.organization_id)
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
         and public.fn_delegacao_sessao_autorizada(c.channel_session_id, c.organization_id)
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
         and public.fn_delegacao_sessao_autorizada(c.channel_session_id, c.organization_id)
    )
  );

-- A 0774 já cuida de ACL e RLS no Storage. Só o dono da tabela (ou
-- papel com a mesma autoridade) troca a policy. Se a DDL falhar, o apply
-- precisa acusar o erro. Nenhum privilégio de Storage é ampliado aqui.
do $$
begin
  if not exists (
    select 1 from pg_class c where c.oid = to_regclass('storage.objects') and c.relrowsecurity
  ) then
    raise exception 'delegacao 0775: storage.objects precisa de RLS ativa (0774)';
  end if;
end $$;

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
             and public.fn_delegacao_sessao_autorizada(m.channel_session_id, m.organization_id)
             and public.fn_delegacao_sessao_autorizada(c.channel_session_id, c.organization_id)
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
             and public.fn_delegacao_sessao_autorizada(c.channel_session_id, c.organization_id)
        )
      )
    )
  );

notify pgrst, 'reload schema';
