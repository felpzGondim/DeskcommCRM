-- manifest: Ficha preliminar versionada por conversa (A1). Uma linha por versão, só acrescenta; RLS por organization_id; escrita só service_role; processo_id nulo até a Fase 3. Sem SECURITY DEFINER. Rollback: drop table public.locacao_fichas_preliminares.

-- ---- ficha preliminar da conversa (migration 0762, fork) ----
--
-- A1 do plano de análise: o atendente gera um relatório preliminar e uma ficha
-- JSON a partir da conversa e dos anexos. Ainda não existe processo de locação
-- — `processo_id` fica nulo, sem FK, para a Fase 3 só apontar. Não cria as
-- tabelas da Fase 3 (`locacao_processos` etc.).
--
-- Só se acrescenta versão. Sem UPDATE/DELETE para authenticated. A retenção de
-- 90 dias fica na Fase 3. Logs e audit() nunca levam valores da ficha.
--
-- Rollback: drop table if exists public.locacao_fichas_preliminares;
-- Gate: tests/invariants/locacao-fichas-preliminares-rls.test.ts.

create table if not exists public.locacao_fichas_preliminares (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  processo_id uuid,
  versao int not null check (versao >= 1),
  base_versao int,
  origem text not null check (origem in ('preliminar_ia', 'atendente')),
  ficha jsonb not null,
  relatorio text not null default '',
  campos_alterados text[] not null default '{}',
  alterado_por uuid references auth.users(id) on delete set null,
  alterado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, conversation_id, versao)
);

create index if not exists locacao_fichas_preliminares_org_conv_idx
  on public.locacao_fichas_preliminares (organization_id, conversation_id, versao desc);

comment on table public.locacao_fichas_preliminares is
  'Versões da ficha preliminar (A1) por conversa. Só acrescenta. processo_id nulo até a Fase 3.';
comment on column public.locacao_fichas_preliminares.campos_alterados is
  'Caminhos de campo que mudaram. Nunca valores (CPF, renda, telefone).';
comment on column public.locacao_fichas_preliminares.processo_id is
  'Reserva para a Fase 3 ligar a ficha a um processo. Sem FK nesta migration.';

alter table public.locacao_fichas_preliminares enable row level security;

drop policy if exists tenant_isolation_locacao_fichas_preliminares_select on public.locacao_fichas_preliminares;
create policy tenant_isolation_locacao_fichas_preliminares_select on public.locacao_fichas_preliminares
  for select using (organization_id in (select public.fn_user_org_ids()));

revoke all on public.locacao_fichas_preliminares from public, anon, authenticated;
grant select on public.locacao_fichas_preliminares to authenticated;
grant all on public.locacao_fichas_preliminares to service_role;

notify pgrst, 'reload schema';
