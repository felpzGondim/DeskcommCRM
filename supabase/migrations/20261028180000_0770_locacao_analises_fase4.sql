-- manifest: Fase 4 (PR 4.0): registro de cotação do seguro-fiança, vocabulário renda/relatório/manual, colunas de confirmação, retenção 90 dias e cascata LGPD. Chaves locacao.analise.* nascem desligadas. Rollback: desligar as chaves; as tabelas ficam.

-- ---- análise de locação (migration 0770, fork, Fase 4 / PR 4.0) ----
-- Respostas do Felipe 28/10/2026: 1a (tabela locacao_analises_seguro igual à FC),
-- 5 (confirmação da FC paga só avisa créditos — sem preço no banco).
-- Chaves locacao.analise.{renda,seguro,fc,relatorio,manual} moram no jsonb
-- organizations.settings; a migration NÃO as liga.
-- Sem dado pessoal neste arquivo.

-- Vocabulário que os PRs 4.1–4.5 gravam sem nova migration.
do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.locacao_processo_eventos'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%tipo%'
       and pg_get_constraintdef(c.oid) like '%analise_fc%'
  loop
    execute format('alter table public.locacao_processo_eventos drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.locacao_processo_eventos
  drop constraint if exists locacao_processo_eventos_tipo_check;
alter table public.locacao_processo_eventos
  add constraint locacao_processo_eventos_tipo_check
  check (tipo in (
    'status','participante','ficha','analise_fc','migra',
    'contrato_preparar','contrato_confirmar','documento','lgpd',
    'renda','relatorio'
  ));

do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.locacao_processo_fichas'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%origem%'
       and pg_get_constraintdef(c.oid) like '%hub_migra%'
  loop
    execute format('alter table public.locacao_processo_fichas drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.locacao_processo_fichas
  drop constraint if exists locacao_processo_fichas_origem_check;
alter table public.locacao_processo_fichas
  add constraint locacao_processo_fichas_origem_check
  check (origem in (
    'preliminar_ia','atendente','hub_fc','hub_migra','contrato','lgpd','manual'
  ));

do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.locacao_processo_documentos'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%origem%'
       and pg_get_constraintdef(c.oid) like '%hub_migra%'
  loop
    execute format('alter table public.locacao_processo_documentos drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.locacao_processo_documentos
  drop constraint if exists locacao_processo_documentos_origem_check;
alter table public.locacao_processo_documentos
  add constraint locacao_processo_documentos_origem_check
  check (origem in (
    'anexo_conversa','upload_manual','hub_fc','hub_migra','relatorio','manual_assistido'
  ));

-- FC: origem hub|manual, login_necessario, laudo, estado cru do Hub.
alter table public.locacao_analises_fc
  add column if not exists origem text,
  add column if not exists documento_id uuid,
  add column if not exists erro_codigo text,
  add column if not exists hub_estado text;

update public.locacao_analises_fc set origem = 'hub' where origem is null;
alter table public.locacao_analises_fc alter column origem set default 'hub';
alter table public.locacao_analises_fc alter column origem set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'locacao_analises_fc_documento_fk'
  ) then
    alter table public.locacao_analises_fc
      add constraint locacao_analises_fc_documento_fk
      foreign key (documento_id) references public.locacao_processo_documentos(id) on delete set null;
  end if;
end $$;

do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.locacao_analises_fc'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%estado%'
       and pg_get_constraintdef(c.oid) like '%aguardando_cobranca%'
  loop
    execute format('alter table public.locacao_analises_fc drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.locacao_analises_fc
  drop constraint if exists locacao_analises_fc_estado_check;
alter table public.locacao_analises_fc
  add constraint locacao_analises_fc_estado_check
  check (estado in (
    'solicitada','aguardando_cobranca','cobrando','concluida',
    'reaproveitada','erro','cancelada','login_necessario'
  ));

alter table public.locacao_analises_fc drop constraint if exists locacao_analises_fc_origem_check;
alter table public.locacao_analises_fc
  add constraint locacao_analises_fc_origem_check
  check (origem in ('hub','manual'));

create index if not exists locacao_analises_fc_org_ativas_idx
  on public.locacao_analises_fc (organization_id, updated_at)
  where estado in ('solicitada','aguardando_cobranca','cobrando');

-- Confirmação de renda (4.1) e rascunho/aprovação do relatório (4.5).
alter table public.locacao_processos
  add column if not exists renda_confirmada_em timestamptz,
  add column if not exists renda_confirmada_por uuid references auth.users(id) on delete set null,
  add column if not exists renda_confirmada_ficha_versao int,
  add column if not exists relatorio_rascunho text,
  add column if not exists relatorio_rascunho_em timestamptz,
  add column if not exists relatorio_rascunho_por uuid references auth.users(id) on delete set null,
  add column if not exists relatorio_aprovado_em timestamptz,
  add column if not exists relatorio_aprovado_por uuid references auth.users(id) on delete set null,
  add column if not exists relatorio_documento_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'locacao_processos_relatorio_documento_fk'
  ) then
    alter table public.locacao_processos
      add constraint locacao_processos_relatorio_documento_fk
      foreign key (relatorio_documento_id) references public.locacao_processo_documentos(id) on delete set null;
  end if;
end $$;

comment on column public.locacao_processos.relatorio_rascunho is
  'Rascunho das 6 seções. Texto da pessoa: a cascata LGPD e a retenção de 90 dias apagam.';
comment on column public.locacao_processos.renda_confirmada_em is
  'Atendente confirmou a renda proposta para a FC. Sem isto, seguro e FC ficam travados.';

create table if not exists public.locacao_analises_seguro (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  processo_id uuid not null references public.locacao_processos(id) on delete cascade,
  participante_id uuid references public.locacao_processo_participantes(id) on delete set null,
  pedido_id uuid not null unique,
  hub_job_id text,
  ficha_versao int,
  estado text not null check (estado in (
    'solicitada','cotando','concluida','erro','login_necessario','cancelada'
  )),
  origem text not null default 'hub' check (origem in ('hub','manual')),
  documento_id uuid references public.locacao_processo_documentos(id) on delete set null,
  autorizado_por uuid references auth.users(id) on delete set null,
  autorizado_em timestamptz,
  resultado jsonb,
  erro_codigo text,
  hub_estado text,
  concluida_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists locacao_analises_seguro_org_proc_andamento_uidx
  on public.locacao_analises_seguro (organization_id, processo_id)
  where estado in ('solicitada','cotando');
create index if not exists locacao_analises_seguro_org_ativas_idx
  on public.locacao_analises_seguro (organization_id, updated_at)
  where estado in ('solicitada','cotando');
create index if not exists locacao_analises_seguro_org_proc_idx
  on public.locacao_analises_seguro (organization_id, processo_id, created_at desc);

comment on table public.locacao_analises_seguro is
  'Uma cotação de seguro-fiança (Migra) por tentativa. Pedido, job do Hub, estado, resultado. Sem Contratar.';
comment on column public.locacao_analises_seguro.resultado is
  'Cards da cotação (seguradora, código, plano, valores). Sem CPF. A cascata e a retenção apagam.';

drop trigger if exists trg_locacao_analises_seguro_updated_at on public.locacao_analises_seguro;
create trigger trg_locacao_analises_seguro_updated_at
  before update on public.locacao_analises_seguro
  for each row execute function public.fn_locacao_touch_updated_at();

alter table public.locacao_analises_seguro enable row level security;

drop policy if exists tenant_isolation_locacao_analises_seguro_select on public.locacao_analises_seguro;
create policy tenant_isolation_locacao_analises_seguro_select on public.locacao_analises_seguro
  for select using (organization_id in (select public.fn_user_org_ids()));

revoke all on public.locacao_analises_seguro from public, anon, authenticated;
grant select on public.locacao_analises_seguro to authenticated;
grant all on public.locacao_analises_seguro to service_role;

-- Retenção 90 dias: também zera cotação e rascunho do relatório.
create or replace function public.fn_expurgar_processos_de_locacao_vencidos(
  p_retencao_dias int default null,
  p_limite int default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dias int := greatest(coalesce(p_retencao_dias, 90), 90);
  v_limite int := least(greatest(coalesce(p_limite, 200), 1), 2000);
  v_corte timestamptz := now() - make_interval(days => v_dias);
  v_n int := 0;
  r record;
begin
  for r in
    select p.id, p.organization_id, p.status
      from public.locacao_processos p
     where p.encerrado_em is not null
       and p.encerrado_em < v_corte
       and p.status in ('contrato_assinado','reprovado','cancelado')
     order by p.encerrado_em
     limit v_limite
  loop
    delete from public.locacao_processo_fichas f
     where f.organization_id = r.organization_id and f.processo_id = r.id;

    delete from public.locacao_processo_documentos d
     where d.organization_id = r.organization_id
       and d.processo_id = r.id
       and (
         r.status <> 'contrato_assinado'
         or (d.drive_status in ('copiado','nao_se_aplica') and d.vps_status in ('copiado','nao_se_aplica'))
       );

    update public.locacao_analises_fc a
       set resultado = null, cpf_hash = null, updated_at = now()
     where a.organization_id = r.organization_id and a.processo_id = r.id;

    update public.locacao_analises_seguro a
       set resultado = null, updated_at = now()
     where a.organization_id = r.organization_id and a.processo_id = r.id;

    update public.locacao_processos p
       set relatorio_rascunho = null, updated_at = now()
     where p.organization_id = r.organization_id and p.id = r.id;

    update public.locacao_processo_participantes ptc
       set nome_exibicao = null, cpf_hash = null, cpf_mascarado = null,
           cpf_encrypted = null, updated_at = now()
     where ptc.organization_id = r.organization_id and ptc.processo_id = r.id;

    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.fn_expurgar_processos_de_locacao_vencidos(int, int) from public, anon, authenticated;
grant execute on function public.fn_expurgar_processos_de_locacao_vencidos(int, int) to service_role;

-- LGPD: anonimização (virada de is_anonymized) e exclusão do contato.
-- INVOKER. Não edita fn_lgpd_cascade_redact_contact.
create or replace function public.fn_locacao_limpar_contato_anonimizado()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_contato uuid;
  v_agir boolean := false;
begin
  if tg_op = 'DELETE' then
    v_org := old.organization_id;
    v_contato := old.id;
    v_agir := true;
  elsif new.is_anonymized is true
     and coalesce(old.is_anonymized, false) is distinct from true then
    v_org := new.organization_id;
    v_contato := new.id;
    v_agir := true;
  end if;

  if v_agir then
    update public.locacao_processo_participantes
       set nome_exibicao = null, cpf_hash = null, cpf_mascarado = null,
           cpf_encrypted = null, updated_at = now()
     where organization_id = v_org and contact_id = v_contato;

    update public.contato_superlogica_vinculos
       set ativo = false, desfeito_em = now(), motivo_desfeito = 'lgpd'
     where organization_id = v_org and contact_id = v_contato and ativo;

    delete from public.superlogica_vinculo_revisoes
     where organization_id = v_org and contact_id = v_contato;

    delete from public.locacao_processo_documentos d
     using public.locacao_processo_participantes p
     where d.organization_id = v_org
       and p.organization_id = v_org
       and d.participante_id = p.id
       and p.contact_id = v_contato;

    update public.locacao_analises_fc a
       set resultado = null, cpf_hash = null, updated_at = now()
     where a.organization_id = v_org
       and a.participante_id in (
         select p.id from public.locacao_processo_participantes p
          where p.organization_id = v_org and p.contact_id = v_contato
       );

    update public.locacao_analises_seguro a
       set resultado = null, updated_at = now()
     where a.organization_id = v_org
       and a.processo_id in (
         select p.processo_id from public.locacao_processo_participantes p
          where p.organization_id = v_org and p.contact_id = v_contato
            and p.papel in ('locatario','solidario','fiador')
       );

    update public.locacao_processos proc
       set relatorio_rascunho = null, updated_at = now()
     where proc.organization_id = v_org
       and proc.id in (
         select p.processo_id from public.locacao_processo_participantes p
          where p.organization_id = v_org and p.contact_id = v_contato
            and p.papel in ('locatario','solidario','fiador')
       );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_locacao_limpar_contato_anonimizado() from public, anon, authenticated;
grant execute on function public.fn_locacao_limpar_contato_anonimizado() to service_role;

drop trigger if exists trg_locacao_limpar_contato_anonimizado on public.contacts;
create trigger trg_locacao_limpar_contato_anonimizado
  after update of is_anonymized on public.contacts
  for each row
  execute function public.fn_locacao_limpar_contato_anonimizado();

drop trigger if exists trg_locacao_limpar_contato_excluido on public.contacts;
create trigger trg_locacao_limpar_contato_excluido
  before delete on public.contacts
  for each row
  execute function public.fn_locacao_limpar_contato_anonimizado();

notify pgrst, 'reload schema';
