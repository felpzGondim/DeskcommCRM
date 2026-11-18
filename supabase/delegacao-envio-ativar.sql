-- Operação manual via psql -v user_id=… -v org_empresarial=… -v org_titular=…
-- -v sessao_titular=… -v oauth_client_id=… -f supabase/delegacao-envio-ativar.sql
\set ON_ERROR_STOP on
begin;

create temporary table delegacao_envio_alvo on commit drop as
select :'user_id'::uuid as uid, :'org_empresarial'::uuid as org_empresarial,
       :'org_titular'::uuid as org_titular, :'sessao_titular'::uuid as sessao,
       :'oauth_client_id'::text as client_id;

do $$
declare
  alvo delegacao_envio_alvo%rowtype;
  empresarial public.delegacao_visibilidade_corporativa%rowtype;
begin
  select * into strict alvo from delegacao_envio_alvo;
  if alvo.org_empresarial = alvo.org_titular then
    raise exception 'As organizações empresarial e titular precisam ser distintas.';
  end if;
  if not exists (
    select 1 from public.delegacao_clientes_autorizados c
    where c.oauth_client_id = alvo.client_id and c.revoked_at is null
  ) then
    raise exception 'O client OAuth precisa estar autorizado.';
  end if;
  select * into empresarial from public.delegacao_visibilidade_corporativa g
  where g.organization_id = alvo.org_empresarial and g.user_id = alvo.uid
    and g.oauth_client_id = alvo.client_id and g.revoked_at is null and g.expires_at > now()
    and g.efeitos && array['buscar','ler','baixar']::text[]
  for update;
  if not found then
    raise exception 'Falta o grant empresarial vivo com efeito de leitura.';
  end if;
  if not exists (
    select 1 from public.user_organizations u
    where u.organization_id = alvo.org_empresarial and u.user_id = alvo.uid
      and u.revoked_at is null and u.role in ('agent','ai_operator','manager','admin','owner')
  ) then
    raise exception 'O envio empresarial exige membership ativa com papel agent ou superior.';
  end if;
  if exists (
    select 1 from public.user_organizations u
    where u.organization_id = alvo.org_titular and u.user_id <> alvo.uid and u.revoked_at is null
  ) then
    raise exception 'A organização titular deve ter apenas a titular como membro ativo.';
  end if;

  update public.delegacao_visibilidade_corporativa
     set efeitos = array_append(efeitos, 'enviar')
   where id = empresarial.id and not ('enviar' = any(efeitos));

  insert into public.delegacao_visibilidade_corporativa as g
    (organization_id, user_id, oauth_client_id, efeitos, expires_at, created_by)
  values
    (alvo.org_titular, alvo.uid, alvo.client_id, array['buscar','ler','baixar','enviar'],
     empresarial.expires_at, alvo.uid)
  on conflict (organization_id, user_id, oauth_client_id) where revoked_at is null do update
  set expires_at = excluded.expires_at
  where g.created_by = excluded.created_by and g.efeitos = excluded.efeitos;
  if not found then
    raise exception 'A organização titular já tem um grant diferente para este sujeito e client.';
  end if;

  insert into public.delegacao_sessoes_titular as t (channel_session_id, organization_id, user_id, created_by)
  values (alvo.sessao, alvo.org_titular, alvo.uid, alvo.uid)
  on conflict (channel_session_id) do update set revoked_at = null
  where t.organization_id = excluded.organization_id and t.user_id = excluded.user_id
    and t.created_by = excluded.created_by;
  if not found then
    raise exception 'A sessão já tem um vínculo titular diferente.';
  end if;
end $$;

select g.organization_id, g.efeitos, g.expires_at, t.channel_session_id
from delegacao_envio_alvo a
join public.delegacao_visibilidade_corporativa g on g.user_id = a.uid and g.oauth_client_id = a.client_id
  and g.organization_id in (a.org_empresarial, a.org_titular) and g.revoked_at is null
left join public.delegacao_sessoes_titular t on t.channel_session_id = a.sessao
  and t.organization_id = g.organization_id and t.revoked_at is null
order by g.organization_id;

commit;
