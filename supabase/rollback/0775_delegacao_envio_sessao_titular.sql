-- Rollback de schema da 0775. Executar com a autoridade usada para aplicar a 0774.
begin;

-- O CHECK exige algum efeito. Só-envio vira registro histórico revogado,
-- com um efeito legado apenas para satisfazer o CHECK restaurado.
update public.delegacao_visibilidade_corporativa
   set efeitos = case when array_remove(efeitos, 'enviar') = '{}'::text[]
                     then array['ler']::text[] else array_remove(efeitos, 'enviar') end,
       revoked_at = case when array_remove(efeitos, 'enviar') = '{}'::text[]
                         then coalesce(revoked_at, now()) else revoked_at end
 where 'enviar' = any(efeitos);

alter table public.delegacao_visibilidade_corporativa
  drop constraint if exists delegacao_visibilidade_corporativa_efeitos_check;
alter table public.delegacao_visibilidade_corporativa
  add constraint delegacao_visibilidade_corporativa_efeitos_check
  check (efeitos <> '{}'::text[] and efeitos <@ array['buscar','ler','baixar']::text[]);

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

drop function if exists public.fn_delegacao_listar_sessoes(uuid);
drop function if exists public.fn_delegacao_sessao_autorizada(uuid, uuid);
drop trigger if exists delegacao_sessao_empresarial_validar on public.delegacao_sessoes_empresariais;

do $$
begin
  if to_regclass('public.delegacao_sessoes_titular') is not null then
    update public.delegacao_sessoes_titular set revoked_at = now() where revoked_at is null;
    drop table public.delegacao_sessoes_titular;
  end if;
end $$;

drop function if exists public.fn_delegacao_sessao_titular(uuid, uuid);
drop function if exists public.fn_delegacao_validar_origem_sessao();

notify pgrst, 'reload schema';
commit;
