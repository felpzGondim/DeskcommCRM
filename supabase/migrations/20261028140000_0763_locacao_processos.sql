-- manifest: Processo de locação (Fase 3): imóveis, processos, participantes, conversas, fichas, eventos e análises FC. RLS por organization_id; escrita só service_role; sem SECURITY DEFINER. Rollback: desligar locacao.processos_habilitado (tabelas ficam).

-- ---- processo de locação (migration 0763, fork, Fase 3) ----
-- Decisões 28/10/2026: papel contato; imóvel próprio chaveado por Superlógica;
-- CPF criptografado; 9 etapas com contrato_criado; fiador FC só a pedido;
-- reaproveitar FC 90 dias. Sem dado pessoal neste arquivo.

create or replace function public.fn_locacao_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.fn_locacao_touch_updated_at() from public, anon, authenticated;
grant execute on function public.fn_locacao_touch_updated_at() to service_role;

create table if not exists public.locacao_imoveis (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  logradouro text not null,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  cep text,
  chave_endereco text not null,
  codigo_fc text,
  tipo text check (tipo in ('residencial','comercial')),
  catalog_product_id uuid references public.catalog_products(id) on delete set null,
  superlogica_imovel_id bigint,
  aluguel_referencia_cents bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists locacao_imoveis_org_chave_sem_sl_uidx
  on public.locacao_imoveis (organization_id, chave_endereco)
  where superlogica_imovel_id is null;
create unique index if not exists locacao_imoveis_org_sl_uidx
  on public.locacao_imoveis (organization_id, superlogica_imovel_id)
  where superlogica_imovel_id is not null;
create unique index if not exists locacao_imoveis_org_catalog_uidx
  on public.locacao_imoveis (organization_id, catalog_product_id)
  where catalog_product_id is not null;

comment on table public.locacao_imoveis is
  'Imóvel da carteira de locação. Chave principal = id Superlógica; endereço só enquanto não há.';

drop trigger if exists trg_locacao_imoveis_updated_at on public.locacao_imoveis;
create trigger trg_locacao_imoveis_updated_at
  before update on public.locacao_imoveis
  for each row execute function public.fn_locacao_touch_updated_at();

alter table public.locacao_imoveis enable row level security;

drop policy if exists tenant_isolation_locacao_imoveis_select on public.locacao_imoveis;
create policy tenant_isolation_locacao_imoveis_select on public.locacao_imoveis
  for select using (organization_id in (select public.fn_user_org_ids()));

revoke all on public.locacao_imoveis from public, anon, authenticated;
grant select on public.locacao_imoveis to authenticated;
grant all on public.locacao_imoveis to service_role;

create table if not exists public.locacao_processos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  imovel_id uuid not null references public.locacao_imoveis(id) on delete restrict,
  status text not null default 'lead' check (status in (
    'lead','documentos','analise','aprovado','reprovado',
    'contrato_preparado','contrato_criado','contrato_assinado','cancelado'
  )),
  status_mudou_em timestamptz not null default now(),
  motivo_status text,
  motivo_cancelamento text check (motivo_cancelamento in ('desistencia','alugado_outro','expirado','outro')),
  ficha_versao_atual int,
  aprovado_por uuid references auth.users(id) on delete set null,
  aprovado_em timestamptz,
  superlogica_contrato_id text,
  contrato_preview_expira_em timestamptz,
  encerrado_em timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists locacao_processos_org_status_idx
  on public.locacao_processos (organization_id, status);
create index if not exists locacao_processos_org_imovel_idx
  on public.locacao_processos (organization_id, imovel_id);
create index if not exists locacao_processos_org_encerrado_idx
  on public.locacao_processos (organization_id, encerrado_em)
  where encerrado_em is not null;

comment on table public.locacao_processos is
  'Processo de locação. Status em 9 etapas. Retenção conta a partir de encerrado_em.';

drop trigger if exists trg_locacao_processos_updated_at on public.locacao_processos;
create trigger trg_locacao_processos_updated_at
  before update on public.locacao_processos
  for each row execute function public.fn_locacao_touch_updated_at();

alter table public.locacao_processos enable row level security;

drop policy if exists tenant_isolation_locacao_processos_select on public.locacao_processos;
create policy tenant_isolation_locacao_processos_select on public.locacao_processos
  for select using (organization_id in (select public.fn_user_org_ids()));

revoke all on public.locacao_processos from public, anon, authenticated;
grant select on public.locacao_processos to authenticated;
grant all on public.locacao_processos to service_role;

create table if not exists public.locacao_processo_participantes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  processo_id uuid not null references public.locacao_processos(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  papel text not null check (papel in ('locatario','solidario','fiador','contato')),
  relacao text check (relacao in ('parente','corretor','conjuge','empresa','outro')),
  principal boolean not null default false,
  interlocutor_principal boolean not null default false,
  fracao numeric(5,2),
  nome_exibicao text,
  cpf_hash text,
  cpf_mascarado text,
  cpf_encrypted bytea,
  removido_em timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locacao_participantes_cpf_consistency check (
    (cpf_encrypted is null) = (cpf_hash is null)
  )
);

create unique index if not exists locacao_participantes_proc_contato_papel_uidx
  on public.locacao_processo_participantes (processo_id, contact_id, papel)
  where contact_id is not null and removido_em is null;
create unique index if not exists locacao_participantes_proc_cpf_uidx
  on public.locacao_processo_participantes (processo_id, cpf_hash)
  where cpf_hash is not null and removido_em is null;
create unique index if not exists locacao_participantes_proc_interlocutor_uidx
  on public.locacao_processo_participantes (processo_id)
  where interlocutor_principal and removido_em is null;
create index if not exists locacao_participantes_org_contato_idx
  on public.locacao_processo_participantes (organization_id, contact_id);
create index if not exists locacao_participantes_org_cpf_idx
  on public.locacao_processo_participantes (organization_id, cpf_hash);

comment on table public.locacao_processo_participantes is
  'Pessoas do processo. Papel contato = só conversa. CPF criptografado; sem id Superlógica (herda do contato).';
comment on column public.locacao_processo_participantes.cpf_mascarado is
  'Máscara para a tela. Nunca o CPF completo.';

drop trigger if exists trg_locacao_participantes_updated_at on public.locacao_processo_participantes;
create trigger trg_locacao_participantes_updated_at
  before update on public.locacao_processo_participantes
  for each row execute function public.fn_locacao_touch_updated_at();

alter table public.locacao_processo_participantes enable row level security;

drop policy if exists tenant_isolation_locacao_processo_participantes_select on public.locacao_processo_participantes;
create policy tenant_isolation_locacao_processo_participantes_select on public.locacao_processo_participantes
  for select using (organization_id in (select public.fn_user_org_ids()));

revoke all on public.locacao_processo_participantes from public, anon, authenticated;
grant select on public.locacao_processo_participantes to authenticated;
grant all on public.locacao_processo_participantes to service_role;

create table if not exists public.locacao_processo_conversas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  processo_id uuid not null references public.locacao_processos(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  participante_id uuid references public.locacao_processo_participantes(id) on delete set null,
  origem text not null check (origem in ('criacao','manual','sugestao')),
  ultimo_uso_em timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (processo_id, conversation_id)
);

create index if not exists locacao_processo_conversas_org_conv_idx
  on public.locacao_processo_conversas (organization_id, conversation_id);

alter table public.locacao_processo_conversas enable row level security;

drop policy if exists tenant_isolation_locacao_processo_conversas_select on public.locacao_processo_conversas;
create policy tenant_isolation_locacao_processo_conversas_select on public.locacao_processo_conversas
  for select using (organization_id in (select public.fn_user_org_ids()));

revoke all on public.locacao_processo_conversas from public, anon, authenticated;
grant select on public.locacao_processo_conversas to authenticated;
grant all on public.locacao_processo_conversas to service_role;

create table if not exists public.locacao_processo_fichas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  processo_id uuid not null references public.locacao_processos(id) on delete cascade,
  versao int not null check (versao >= 1),
  base_versao int,
  ficha jsonb not null,
  origem text not null check (origem in (
    'preliminar_ia','atendente','hub_fc','hub_migra','contrato','lgpd'
  )),
  campos_alterados text[] not null default '{}',
  alterado_por uuid references auth.users(id) on delete set null,
  alterado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (processo_id, versao)
);

comment on column public.locacao_processo_fichas.campos_alterados is
  'Caminhos de campo. Nunca valores.';

alter table public.locacao_processo_fichas enable row level security;

drop policy if exists tenant_isolation_locacao_processo_fichas_select on public.locacao_processo_fichas;
create policy tenant_isolation_locacao_processo_fichas_select on public.locacao_processo_fichas
  for select using (organization_id in (select public.fn_user_org_ids()));

revoke all on public.locacao_processo_fichas from public, anon, authenticated;
grant select on public.locacao_processo_fichas to authenticated;
grant all on public.locacao_processo_fichas to service_role;

create table if not exists public.locacao_processo_eventos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  processo_id uuid not null references public.locacao_processos(id) on delete cascade,
  tipo text not null check (tipo in (
    'status','participante','ficha','analise_fc','migra',
    'contrato_preparar','contrato_confirmar','documento','lgpd'
  )),
  de text,
  para text,
  ator_tipo text not null check (ator_tipo in ('usuario','sistema','hub')),
  ator_id uuid,
  detalhe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists locacao_processo_eventos_proc_created_idx
  on public.locacao_processo_eventos (processo_id, created_at);
comment on column public.locacao_processo_eventos.detalhe is
  'Só ids, versões e caminhos. Nunca valores pessoais.';

alter table public.locacao_processo_eventos enable row level security;

drop policy if exists tenant_isolation_locacao_processo_eventos_select on public.locacao_processo_eventos;
create policy tenant_isolation_locacao_processo_eventos_select on public.locacao_processo_eventos
  for select using (organization_id in (select public.fn_user_org_ids()));

revoke all on public.locacao_processo_eventos from public, anon, authenticated;
grant select on public.locacao_processo_eventos to authenticated;
grant all on public.locacao_processo_eventos to service_role;

create table if not exists public.locacao_analises_fc (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  processo_id uuid not null references public.locacao_processos(id) on delete cascade,
  participante_id uuid references public.locacao_processo_participantes(id) on delete set null,
  cpf_hash text,
  pedido_id uuid not null unique,
  hub_job_id text,
  ficha_versao int,
  estado text not null check (estado in (
    'solicitada','aguardando_cobranca','cobrando','concluida','reaproveitada','erro','cancelada'
  )),
  reaproveitou_de uuid references public.locacao_analises_fc(id) on delete set null,
  autorizado_por uuid references auth.users(id) on delete set null,
  autorizado_em timestamptz,
  resultado jsonb,
  concluida_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists locacao_analises_fc_org_cpf_andamento_uidx
  on public.locacao_analises_fc (organization_id, cpf_hash)
  where estado in ('solicitada','aguardando_cobranca','cobrando') and cpf_hash is not null;
create index if not exists locacao_analises_fc_org_cpf_concluida_idx
  on public.locacao_analises_fc (organization_id, cpf_hash, concluida_em desc);

comment on table public.locacao_analises_fc is
  'Uma tentativa de FC por pessoa. Trava anti-cobrança dupla pelo índice único parcial.';

drop trigger if exists trg_locacao_analises_fc_updated_at on public.locacao_analises_fc;
create trigger trg_locacao_analises_fc_updated_at
  before update on public.locacao_analises_fc
  for each row execute function public.fn_locacao_touch_updated_at();

alter table public.locacao_analises_fc enable row level security;

drop policy if exists tenant_isolation_locacao_analises_fc_select on public.locacao_analises_fc;
create policy tenant_isolation_locacao_analises_fc_select on public.locacao_analises_fc
  for select using (organization_id in (select public.fn_user_org_ids()));

revoke all on public.locacao_analises_fc from public, anon, authenticated;
grant select on public.locacao_analises_fc to authenticated;
grant all on public.locacao_analises_fc to service_role;

notify pgrst, 'reload schema';
