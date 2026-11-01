-- manifest: Tabela locacao_execucoes (uma execução por aba do modal de locação, com fila, progresso, hash da entrada e resultado). Amplia origem/categoria de documentos com ficha_cadastral (caminho {org}/processos/{id}/ficha_cadastral/), ficha_migra e origem contrato. Sem função privilegiada nova. Rollback: as tabelas ficam; o código deixa de gravá-las.

-- ---- execuções por aba do modal de locação (migration 0772, fork) ----
-- PR 1 do plano modal-locacao-20261101. Sem dado pessoal neste arquivo.
-- Sem função privilegiada nova. Escrita só service_role; membro lê a própria org.
-- Chaves da Fase 4 e o GET da Superlógica continuam desligados.

create table if not exists public.locacao_execucoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  processo_id uuid not null references public.locacao_processos(id) on delete cascade,
  participante_id uuid references public.locacao_processo_participantes(id) on delete set null,
  aba text not null check (aba in (
    'dados','renda','fc','migra','relatorio','contrato','documentos'
  )),
  estado text not null default 'na_fila' check (estado in (
    'na_fila','processando','concluido','erro','desatualizado'
  )),
  etapa_texto text,
  progresso_atual int not null default 0 check (progresso_atual >= 0),
  progresso_total int not null default 0 check (progresso_total >= 0),
  erro_codigo text,
  erro_motivo text,
  entrada_hash text,
  ficha_versao int,
  origem text not null check (origem in ('botao','chat')),
  ator_user_id uuid references auth.users(id) on delete set null,
  resultado jsonb,
  iniciado_em timestamptz,
  terminado_em timestamptz,
  call_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locacao_execucoes_progresso_check check (
    progresso_total = 0 or progresso_atual <= progresso_total
  )
);

create index if not exists locacao_execucoes_proc_aba_created_idx
  on public.locacao_execucoes (processo_id, aba, created_at desc);
create index if not exists locacao_execucoes_org_proc_idx
  on public.locacao_execucoes (organization_id, processo_id, created_at desc);
create unique index if not exists locacao_execucoes_proc_aba_andamento_uidx
  on public.locacao_execucoes (organization_id, processo_id, aba)
  where estado in ('na_fila', 'processando');

comment on table public.locacao_execucoes is
  'Uma execução por aba do modal (dados, renda, FC, Migra, relatório, contrato, documentos). Fila, progresso, hash da entrada e resultado. Sem PII neste comentário.';
comment on column public.locacao_execucoes.entrada_hash is
  'Hash da entrada usada. Quando um dado muda, a execução concluída vira desatualizado.';
comment on column public.locacao_execucoes.resultado is
  'Saída estruturada da aba. Sem CPF. A cascata LGPD ainda não zera esta coluna (PR posterior).';
comment on column public.locacao_execucoes.erro_motivo is
  'Motivo simples para a tela (Tentar de novo). Sem dado pessoal.';

drop trigger if exists trg_locacao_execucoes_updated_at on public.locacao_execucoes;
create trigger trg_locacao_execucoes_updated_at
  before update on public.locacao_execucoes
  for each row execute function public.fn_locacao_touch_updated_at();

alter table public.locacao_execucoes enable row level security;

drop policy if exists tenant_isolation_locacao_execucoes_select on public.locacao_execucoes;
create policy tenant_isolation_locacao_execucoes_select on public.locacao_execucoes
  for select using (organization_id in (select public.fn_user_org_ids()));

revoke all on public.locacao_execucoes from public, anon, authenticated;
grant select on public.locacao_execucoes to authenticated;
grant all on public.locacao_execucoes to service_role;

-- Documentos: ficha cadastral impressa (PR #37, grupo 2) + ficha da Migra +
-- origem do contrato gerado. Já existiam: laudo_fc+hub_fc, cotacao_seguro+hub_migra,
-- categoria contrato. Caminho documentado: {org}/processos/{id}/ficha_cadastral/
-- O CHECK de storage_path (0766) já aceita qualquer pasta sob {org}/processos/.

do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.locacao_processo_documentos'::regclass
       and c.contype = 'c'
       and (
         pg_get_constraintdef(c.oid) like '%categoria%'
         or pg_get_constraintdef(c.oid) like '%origem%'
       )
  loop
    execute format('alter table public.locacao_processo_documentos drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.locacao_processo_documentos
  drop constraint if exists locacao_processo_documentos_categoria_check;
alter table public.locacao_processo_documentos
  add constraint locacao_processo_documentos_categoria_check
  check (categoria in (
    'documento_pessoal','comprovante_renda','laudo_fc','cotacao_seguro',
    'relatorio','contrato','outro','ficha_cadastral','ficha_migra'
  ));

alter table public.locacao_processo_documentos
  drop constraint if exists locacao_processo_documentos_origem_check;
alter table public.locacao_processo_documentos
  add constraint locacao_processo_documentos_origem_check
  check (origem in (
    'anexo_conversa','upload_manual','hub_fc','hub_migra','relatorio',
    'manual_assistido','ficha_cadastral','contrato'
  ));

comment on column public.locacao_processo_documentos.categoria is
  'documento_pessoal | comprovante_renda | laudo_fc | cotacao_seguro | relatorio | contrato | outro | ficha_cadastral | ficha_migra. Pasta do storage: {org}/processos/{processo_id}/{categoria}/.';
comment on column public.locacao_processo_documentos.storage_path is
  'Bucket locacao-processos. Prefixo {org}/processos/{processo_id}/. Ficha cadastral impressa: {org}/processos/{processo_id}/ficha_cadastral/{id}.{ext}. Sem nome, CPF ou telefone.';

notify pgrst, 'reload schema';
