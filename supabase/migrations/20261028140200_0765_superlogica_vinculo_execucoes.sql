-- manifest: Fase 3.5: execuções e revisões do casamento Superlógica + backfill idempotente das chaves custom_fields já gravadas (sem apagá-las). RLS por organization_id.

-- ---- superlogica vínculo execuções e revisões (migration 0765, fork, Fase 3.5) ----
-- Padrões sujeitos à revisão do Felipe (perguntas 1–12 = a).

create table if not exists public.superlogica_vinculo_execucoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  modo text not null check (modo in ('simulacao','valendo')),
  estado text not null check (estado in ('rodando','concluida','erro','cancelada')),
  iniciado_por uuid references auth.users(id) on delete set null,
  iniciado_em timestamptz not null default now(),
  terminado_em timestamptz,
  resumo jsonb not null default '{}'::jsonb,
  erro_codigo text,
  created_at timestamptz not null default now()
);

create unique index if not exists superlogica_vinculo_execucoes_org_rodando_uidx
  on public.superlogica_vinculo_execucoes (organization_id)
  where estado = 'rodando';

comment on column public.superlogica_vinculo_execucoes.resumo is
  'Só contagens. Nunca telefone, nome ou CPF.';

alter table public.superlogica_vinculo_execucoes enable row level security;

drop policy if exists tenant_isolation_superlogica_vinculo_execucoes_select on public.superlogica_vinculo_execucoes;
create policy tenant_isolation_superlogica_vinculo_execucoes_select on public.superlogica_vinculo_execucoes
  for select using (organization_id in (select public.fn_user_org_ids()));

revoke all on public.superlogica_vinculo_execucoes from public, anon, authenticated;
grant select on public.superlogica_vinculo_execucoes to authenticated;
grant all on public.superlogica_vinculo_execucoes to service_role;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contato_superlogica_vinculos_execucao_fk'
  ) then
    alter table public.contato_superlogica_vinculos
      add constraint contato_superlogica_vinculos_execucao_fk
      foreign key (execucao_id) references public.superlogica_vinculo_execucoes(id) on delete set null;
  end if;
end $$;

create table if not exists public.superlogica_vinculo_revisoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  execucao_id uuid references public.superlogica_vinculo_execucoes(id) on delete set null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  candidatos jsonb not null default '[]'::jsonb,
  categoria text not null check (categoria in (
    'unico_exato','unico_parcial','varias_pessoas_um_numero','uma_pessoa_varios_contatos',
    'ja_vinculado_igual','ja_vinculado_diferente','numero_mudou','sem_casamento','fora'
  )),
  chave_hash text,
  estado text not null default 'pendente' check (estado in ('pendente','ligado','nao_ligar','expirado')),
  decidido_por uuid references auth.users(id) on delete set null,
  decidido_em timestamptz,
  expira_em timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists superlogica_vinculo_revisoes_org_estado_idx
  on public.superlogica_vinculo_revisoes (organization_id, estado);
create unique index if not exists superlogica_vinculo_revisoes_org_contato_pendente_uidx
  on public.superlogica_vinculo_revisoes (organization_id, contact_id)
  where estado = 'pendente';

comment on column public.superlogica_vinculo_revisoes.candidatos is
  'Lista de {superlogica_pessoa_id, tipo, ativo, qualidade}. Só ids.';
comment on column public.superlogica_vinculo_revisoes.chave_hash is
  'Hash da chave de telefone, para saber se mudou. Nunca o número.';

alter table public.superlogica_vinculo_revisoes enable row level security;

drop policy if exists tenant_isolation_superlogica_vinculo_revisoes_select on public.superlogica_vinculo_revisoes;
create policy tenant_isolation_superlogica_vinculo_revisoes_select on public.superlogica_vinculo_revisoes
  for select using (organization_id in (select public.fn_user_org_ids()));

revoke all on public.superlogica_vinculo_revisoes from public, anon, authenticated;
grant select on public.superlogica_vinculo_revisoes to authenticated;
grant all on public.superlogica_vinculo_revisoes to service_role;

-- Backfill idempotente: chaves já gravadas em contacts.custom_fields (lote
-- fase35-20261028 e quaisquer outras com superlogica_id_pessoa). NÃO apaga as
-- chaves — o CRM continua lendo-as até a tela nova ser o único caminho.
insert into public.contato_superlogica_vinculos (
  organization_id, contact_id, superlogica_pessoa_id, tipos, origem, qualidade,
  ativo, vinculado_em
)
select
  c.organization_id,
  c.id,
  trim(c.custom_fields->>'superlogica_id_pessoa'),
  case
    when coalesce(c.custom_fields->>'superlogica_tipo','') in ('locatario','fiador','proprietario')
      then array[c.custom_fields->>'superlogica_tipo']
    else '{}'::text[]
  end,
  'casamento_telefone',
  case c.custom_fields->>'superlogica_qualidade'
    when 'exato' then 'exato'
    when 'sem_9' then 'sem_9'
    when 'ddd_presumido' then 'ddd_presumido'
    else null
  end,
  true,
  coalesce(
    nullif(c.custom_fields->>'superlogica_vinculado_em','')::timestamptz,
    now()
  )
from public.contacts c
where c.custom_fields ? 'superlogica_id_pessoa'
  and trim(c.custom_fields->>'superlogica_id_pessoa') ~ '^\d+$'
  and not exists (
    select 1 from public.contato_superlogica_vinculos v
    where v.organization_id = c.organization_id
      and v.contact_id = c.id
      and v.ativo
  );

notify pgrst, 'reload schema';
