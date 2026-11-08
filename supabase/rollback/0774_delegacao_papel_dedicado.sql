-- Rollback COMPLETO da migration 0774 (papel oauth_delegado).
-- NÃO é `agent.sh` / troca de imagem: isso não reverte banco, policies, ACL
-- nem config do Auth. Exige backup lógico ANTES de aplicar 0774 e, para
-- desfazer, este arquivo (policies/ACL/hook/tabelas/papel) + restaurar config
-- do Auth (hook URI/enabled) se tiver sido ligada à parte.
--
-- Restaura o TO das policies recastadas (voltam a PUBLIC, como no dump) e o
-- FOR ALL de contacts. NÃO desliga RLS em storage.objects: no stub do CI ela
-- nascia OFF; no Supabase real (PG 17.x desta instalação) storage.objects já
-- nasce com RLS. Desligar seria mudar o produto, não desfazer 0774.
--
-- Idempotente. Sem PII. Não toca dados de conversa.

-- 1) Policies dedicadas
drop policy if exists contacts_select_oauth_delegado on public.contacts;
drop policy if exists conversations_select_oauth_delegado on public.conversations;
drop policy if exists messages_select_oauth_delegado on public.messages;
drop policy if exists locacao_processo_conversas_select_oauth_delegado
  on public.locacao_processo_conversas;
drop policy if exists locacao_processo_documentos_select_oauth_delegado
  on public.locacao_processo_documentos;
drop policy if exists storage_objects_select_oauth_delegado on storage.objects;
drop policy if exists delegacao_visibilidade_corporativa_select
  on public.delegacao_visibilidade_corporativa;
drop policy if exists delegacao_sessoes_empresariais_select
  on public.delegacao_sessoes_empresariais;
drop policy if exists delegacao_contas_empresariais_select
  on public.delegacao_contas_empresariais;

-- 2) Recast PUBLIC (sem TO) — estado pré-0774 do dump
drop policy if exists "conversations_select" on public.conversations;
create policy "conversations_select" on public.conversations
  for select using (
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
  for select using (
    public.fn_is_platform_admin()
    or exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
    )
  );

drop policy if exists "tenant_isolation_contacts_read" on public.contacts;
create policy "tenant_isolation_contacts_read" on public.contacts
  for select using (
    organization_id in (select public.fn_user_org_ids())
    or public.fn_is_platform_admin()
  );

drop policy if exists "tenant_isolation_contacts_write_insert" on public.contacts;
drop policy if exists "tenant_isolation_contacts_write_update" on public.contacts;
drop policy if exists "tenant_isolation_contacts_write_delete" on public.contacts;
drop policy if exists "tenant_isolation_contacts_write" on public.contacts;
create policy "tenant_isolation_contacts_write" on public.contacts
  for all using (
    organization_id in (select public.fn_user_org_ids())
    or public.fn_is_platform_admin_full()
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    or public.fn_is_platform_admin_full()
  );

drop policy if exists tenant_isolation_locacao_processo_conversas_select
  on public.locacao_processo_conversas;
create policy tenant_isolation_locacao_processo_conversas_select
  on public.locacao_processo_conversas
  for select using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists tenant_isolation_locacao_processo_documentos_select
  on public.locacao_processo_documentos;
create policy tenant_isolation_locacao_processo_documentos_select
  on public.locacao_processo_documentos
  for select using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists "tenant_read_ai_policy" on storage.objects;
create policy "tenant_read_ai_policy" on storage.objects for select
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
create policy "tenant_write_ai_policy" on storage.objects for insert
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
create policy "tenant_delete_ai_policy" on storage.objects for delete
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
create policy "tenant_read_lgpd_exports" on storage.objects for select
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
  for select using (
    bucket_id = 'propostas'
    and (split_part(name, '/', 1))::uuid in (select public.fn_user_org_ids())
  );

drop policy if exists "locacao-processos: leitura por organizacao" on storage.objects;
create policy "locacao-processos: leitura por organizacao" on storage.objects
  for select using (
    bucket_id = 'locacao-processos'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    and (split_part(name, '/', 1))::uuid in (select public.fn_user_org_ids())
  );

-- 3) Funções, tabelas, papel (revoke membership NÃO basta sozinho)
drop function if exists public.fn_delegacao_contato_corporativo(uuid, uuid);
drop function if exists public.fn_delegacao_sessao_empresarial(uuid, uuid);
drop function if exists public.fn_delegacao_grant_vivo(uuid);
drop function if exists public.fn_delegacao_access_token_hook(jsonb);

drop table if exists public.delegacao_sessoes_empresariais;
drop table if exists public.delegacao_contas_empresariais;
drop table if exists public.delegacao_visibilidade_corporativa;
drop table if exists public.delegacao_clientes_autorizados;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'oauth_delegado') then
    execute 'revoke all on schema public from oauth_delegado';
    execute 'revoke all on schema auth from oauth_delegado';
    execute 'revoke all on schema storage from oauth_delegado';
    execute 'revoke all on all tables in schema public from oauth_delegado';
    execute 'revoke all on all functions in schema public from oauth_delegado';
    begin
      execute 'revoke all on all tables in schema storage from oauth_delegado';
    exception when others then
      null;
    end;
    begin
      execute 'revoke all on function auth.uid() from oauth_delegado';
      execute 'revoke all on function auth.jwt() from oauth_delegado';
    exception when others then
      null;
    end;
    execute 'revoke oauth_delegado from authenticator';
    begin
      execute 'drop role oauth_delegado';
    exception when dependent_objects_still_exist then
      -- Harness multi-db: o molde ainda referencia o papel. Na instalação
      -- de um banco só o DROP sucede depois dos REVOKEs acima.
      null;
    end;
  end if;
end
$$;

-- authenticator pré-existia no Supabase real; não dropamos.

notify pgrst, 'reload schema';
