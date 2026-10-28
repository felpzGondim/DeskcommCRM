-- manifest: Registro das perguntas do Painel do agente (agent_panel_query_log): pergunta/resposta, ferramentas, custo e etapa; RLS por organization_id; cascata LGPD por gatilho INVOKER; retenção 1 ano. A chave painel_agente.ferramentas_habilitado NÃO é ligada. Sem SECURITY DEFINER exposta. Rollback: desligar a chave (tabela fica).

-- ---- registro das perguntas do painel (migration 0769, fork) ----
-- Decisões 28/10/2026: tetos 6/10 passos, US$ 0,05 / 0,30, 45s / 120s;
-- boletos só leitura; qualquer atendente; retenção 1 ano; análise e contrato
-- exigem clique humano. A migration NÃO liga painel_agente.ferramentas_habilitado.

create table if not exists public.agent_panel_query_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  user_id uuid not null,
  pergunta text not null default '',
  resposta text,
  modo text not null default 'normal' check (modo in ('normal', 'analise')),
  status text not null default 'rodando' check (status in ('rodando', 'pronto', 'erro')),
  etapa_atual text,
  ferramentas jsonb not null default '[]'::jsonb,
  propostas jsonb not null default '[]'::jsonb,
  passos integer not null default 0,
  tokens_entrada integer not null default 0,
  tokens_saida integer not null default 0,
  custo_usd numeric(12, 6) not null default 0,
  duracao_ms integer,
  parou_por text check (parou_por is null or parou_por in ('fim', 'passos', 'custo', 'tempo')),
  llm_call_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_panel_query_log_org_created_idx
  on public.agent_panel_query_log (organization_id, created_at desc);
create index if not exists agent_panel_query_log_org_conv_idx
  on public.agent_panel_query_log (organization_id, conversation_id, created_at desc);
create index if not exists agent_panel_query_log_org_contact_idx
  on public.agent_panel_query_log (organization_id, contact_id);

comment on table public.agent_panel_query_log is
  'Pergunta do Painel do agente: texto, ferramentas, custo e etapa. Entra na cascata LGPD. Retenção 1 ano.';
comment on column public.agent_panel_query_log.pergunta is
  'Texto da pergunta do atendente, já mascarado (CPF/telefone).';
comment on column public.agent_panel_query_log.resposta is
  'Texto da resposta da IA, já mascarado. Nunca enviado ao cliente.';
comment on column public.agent_panel_query_log.etapa_atual is
  'Andamento para o polling da tela enquanto status=rodando. Nulo quando pronto.';

alter table public.agent_panel_query_log enable row level security;

drop policy if exists tenant_isolation_agent_panel_query_log_select on public.agent_panel_query_log;
create policy tenant_isolation_agent_panel_query_log_select on public.agent_panel_query_log
  for select using (organization_id in (select public.fn_user_org_ids()));

revoke all on public.agent_panel_query_log from public, anon, authenticated;
grant select on public.agent_panel_query_log to authenticated;
grant all on public.agent_panel_query_log to service_role;

create or replace function public.fn_expurgar_consultas_do_painel_vencidas(
  p_retencao_dias int default null,
  p_limite int default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dias int := greatest(coalesce(p_retencao_dias, 365), 365);
  v_limite int := least(greatest(coalesce(p_limite, 500), 1), 5000);
  v_corte timestamptz := now() - make_interval(days => v_dias);
  v_n int;
begin
  with vencidas as (
    select id from public.agent_panel_query_log
     where created_at < v_corte
     order by created_at
     limit v_limite
  )
  delete from public.agent_panel_query_log r
   using vencidas v where r.id = v.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.fn_expurgar_consultas_do_painel_vencidas(int, int) from public, anon, authenticated;
grant execute on function public.fn_expurgar_consultas_do_painel_vencidas(int, int) to service_role;

create or replace function public.fn_painel_limpar_contato_anonimizado()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.is_anonymized is true and coalesce(old.is_anonymized, false) is distinct from true then
    update public.agent_panel_query_log
       set pergunta = '(anonimizado)',
           resposta = '(anonimizado)',
           ferramentas = '[]'::jsonb,
           propostas = '[]'::jsonb,
           updated_at = now()
     where organization_id = new.organization_id and contact_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_painel_limpar_contato_anonimizado() from public, anon, authenticated;
grant execute on function public.fn_painel_limpar_contato_anonimizado() to service_role;

drop trigger if exists trg_painel_limpar_contato_anonimizado on public.contacts;
create trigger trg_painel_limpar_contato_anonimizado
  after update of is_anonymized on public.contacts
  for each row
  execute function public.fn_painel_limpar_contato_anonimizado();

notify pgrst, 'reload schema';
