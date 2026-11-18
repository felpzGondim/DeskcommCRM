-- Operação manual. Usa os mesmos cinco parâmetros da ativação.
\set ON_ERROR_STOP on
begin;

create temporary table delegacao_envio_alvo on commit drop as
select :'user_id'::uuid as uid, :'org_empresarial'::uuid as org_empresarial,
       :'org_titular'::uuid as org_titular, :'sessao_titular'::uuid as sessao,
       :'oauth_client_id'::text as client_id;

do $$
begin
  if exists (select 1 from delegacao_envio_alvo where org_empresarial = org_titular) then
    raise exception 'As organizações empresarial e titular precisam ser distintas.';
  end if;
  if exists (
    select 1 from delegacao_envio_alvo a join public.delegacao_visibilidade_corporativa g
      on g.organization_id = a.org_titular and g.user_id = a.uid and g.oauth_client_id = a.client_id
    where g.revoked_at is null and
      (g.created_by is distinct from a.uid or g.efeitos <> array['buscar','ler','baixar','enviar']::text[])
  ) or exists (
    select 1 from delegacao_envio_alvo a join public.delegacao_sessoes_titular t
      on t.channel_session_id = a.sessao
    where t.revoked_at is null and
      (t.organization_id <> a.org_titular or t.user_id <> a.uid or t.created_by is distinct from a.uid)
  ) then
    raise exception 'O grant ou o vínculo ativo diverge do cadastro da ativação.';
  end if;
end $$;

-- Revogue o grant titular e conserve a trilha. O empresarial mantém a leitura.
update public.delegacao_visibilidade_corporativa g
set efeitos = case when array_remove(g.efeitos, 'enviar') = '{}'::text[]
                   then g.efeitos else array_remove(g.efeitos, 'enviar') end,
    revoked_at = case when array_remove(g.efeitos, 'enviar') = '{}'::text[]
                      then now() else g.revoked_at end
from delegacao_envio_alvo a
where g.organization_id = a.org_empresarial and g.user_id = a.uid and g.oauth_client_id = a.client_id
  and g.revoked_at is null and 'enviar' = any(g.efeitos);

update public.delegacao_visibilidade_corporativa g
set revoked_at = now()
from delegacao_envio_alvo a
where g.organization_id = a.org_titular and g.user_id = a.uid and g.oauth_client_id = a.client_id
  and g.created_by = a.uid and g.efeitos = array['buscar','ler','baixar','enviar']::text[]
  and g.revoked_at is null;

update public.delegacao_sessoes_titular t
set revoked_at = now()
from delegacao_envio_alvo a
where t.channel_session_id = a.sessao and t.organization_id = a.org_titular
  and t.user_id = a.uid and t.created_by = a.uid and t.revoked_at is null;

select a.org_empresarial, a.org_titular, a.sessao as channel_session_id,
       not exists (
         select 1 from public.delegacao_visibilidade_corporativa g
         where g.user_id = a.uid and g.oauth_client_id = a.client_id
           and g.organization_id in (a.org_empresarial, a.org_titular)
           and g.revoked_at is null and g.expires_at > now() and 'enviar' = any(g.efeitos)
       ) as envio_desativado
from delegacao_envio_alvo a;

commit;
