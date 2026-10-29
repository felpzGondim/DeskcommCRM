-- manifest: Valores mensais do imóvel no processo de locação (aluguel, condomínio com rateio, IPTU, seguro-incêndio, seguro-fiança informativo), com origem e quem/quando editou. Sem função privilegiada nova. Rollback: as colunas ficam; FC/Migra deixam de exigí-las se o código voltar.

-- ---- valores do imóvel no processo (migration 0771, fork) ----
-- Opções 2a (snapshot no processo) e 2c (3× = aluguel+condomínio+IPTU+seguro-incêndio;
-- seguro-fiança informativo, fora do 3×). Sem dado pessoal neste arquivo.
-- Chaves da Fase 4 e o GET da Superlógica continuam desligados.

alter table public.locacao_processos
  add column if not exists aluguel numeric(12,2),
  add column if not exists condominio numeric(12,2),
  add column if not exists iptu numeric(12,2),
  add column if not exists seguro_incendio numeric(12,2),
  add column if not exists seguro_fianca numeric(12,2),
  add column if not exists aluguel_origem text,
  add column if not exists condominio_origem text,
  add column if not exists iptu_origem text,
  add column if not exists seguro_incendio_origem text,
  add column if not exists seguro_fianca_origem text,
  add column if not exists aluguel_editado_por uuid references auth.users(id) on delete set null,
  add column if not exists condominio_editado_por uuid references auth.users(id) on delete set null,
  add column if not exists iptu_editado_por uuid references auth.users(id) on delete set null,
  add column if not exists seguro_incendio_editado_por uuid references auth.users(id) on delete set null,
  add column if not exists seguro_fianca_editado_por uuid references auth.users(id) on delete set null,
  add column if not exists aluguel_editado_em timestamptz,
  add column if not exists condominio_editado_em timestamptz,
  add column if not exists iptu_editado_em timestamptz,
  add column if not exists seguro_incendio_editado_em timestamptz,
  add column if not exists seguro_fianca_editado_em timestamptz;

do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.locacao_processos'::regclass
       and c.contype = 'c'
       and c.conname like 'locacao_processos_%origem%'
  loop
    execute format('alter table public.locacao_processos drop constraint if exists %I', r.conname);
  end loop;
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.locacao_processos'::regclass
       and c.contype = 'c'
       and (
         c.conname like 'locacao_processos_%_par_check'
         or c.conname like 'locacao_processos_%_nao_negativo_check'
       )
  loop
    execute format('alter table public.locacao_processos drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.locacao_processos
  drop constraint if exists locacao_processos_aluguel_origem_check;
alter table public.locacao_processos
  add constraint locacao_processos_aluguel_origem_check
  check (aluguel_origem is null or aluguel_origem in ('superlogica','conversa','manual'));

alter table public.locacao_processos
  drop constraint if exists locacao_processos_condominio_origem_check;
alter table public.locacao_processos
  add constraint locacao_processos_condominio_origem_check
  check (condominio_origem is null or condominio_origem in ('superlogica','conversa','manual'));

alter table public.locacao_processos
  drop constraint if exists locacao_processos_iptu_origem_check;
alter table public.locacao_processos
  add constraint locacao_processos_iptu_origem_check
  check (iptu_origem is null or iptu_origem in ('superlogica','conversa','manual'));

alter table public.locacao_processos
  drop constraint if exists locacao_processos_seguro_incendio_origem_check;
alter table public.locacao_processos
  add constraint locacao_processos_seguro_incendio_origem_check
  check (seguro_incendio_origem is null or seguro_incendio_origem in ('superlogica','conversa','manual'));

alter table public.locacao_processos
  drop constraint if exists locacao_processos_seguro_fianca_origem_check;
alter table public.locacao_processos
  add constraint locacao_processos_seguro_fianca_origem_check
  check (seguro_fianca_origem is null or seguro_fianca_origem in ('superlogica','conversa','manual'));

alter table public.locacao_processos
  drop constraint if exists locacao_processos_aluguel_par_check;
alter table public.locacao_processos
  add constraint locacao_processos_aluguel_par_check
  check ((aluguel is null) = (aluguel_origem is null));

alter table public.locacao_processos
  drop constraint if exists locacao_processos_condominio_par_check;
alter table public.locacao_processos
  add constraint locacao_processos_condominio_par_check
  check ((condominio is null) = (condominio_origem is null));

alter table public.locacao_processos
  drop constraint if exists locacao_processos_iptu_par_check;
alter table public.locacao_processos
  add constraint locacao_processos_iptu_par_check
  check ((iptu is null) = (iptu_origem is null));

alter table public.locacao_processos
  drop constraint if exists locacao_processos_seguro_incendio_par_check;
alter table public.locacao_processos
  add constraint locacao_processos_seguro_incendio_par_check
  check ((seguro_incendio is null) = (seguro_incendio_origem is null));

alter table public.locacao_processos
  drop constraint if exists locacao_processos_seguro_fianca_par_check;
alter table public.locacao_processos
  add constraint locacao_processos_seguro_fianca_par_check
  check ((seguro_fianca is null) = (seguro_fianca_origem is null));

alter table public.locacao_processos
  drop constraint if exists locacao_processos_aluguel_nao_negativo_check;
alter table public.locacao_processos
  add constraint locacao_processos_aluguel_nao_negativo_check
  check (aluguel is null or aluguel >= 0);

alter table public.locacao_processos
  drop constraint if exists locacao_processos_condominio_nao_negativo_check;
alter table public.locacao_processos
  add constraint locacao_processos_condominio_nao_negativo_check
  check (condominio is null or condominio >= 0);

alter table public.locacao_processos
  drop constraint if exists locacao_processos_iptu_nao_negativo_check;
alter table public.locacao_processos
  add constraint locacao_processos_iptu_nao_negativo_check
  check (iptu is null or iptu >= 0);

alter table public.locacao_processos
  drop constraint if exists locacao_processos_seguro_incendio_nao_negativo_check;
alter table public.locacao_processos
  add constraint locacao_processos_seguro_incendio_nao_negativo_check
  check (seguro_incendio is null or seguro_incendio >= 0);

alter table public.locacao_processos
  drop constraint if exists locacao_processos_seguro_fianca_nao_negativo_check;
alter table public.locacao_processos
  add constraint locacao_processos_seguro_fianca_nao_negativo_check
  check (seguro_fianca is null or seguro_fianca >= 0);

comment on column public.locacao_processos.aluguel is
  'Aluguel mensal em reais do processo. Snapshot; não vive no catálogo do imóvel.';
comment on column public.locacao_processos.condominio is
  'Condomínio mensal em reais, inclui rateio. Nulo até pré-preencher ou editar.';
comment on column public.locacao_processos.iptu is
  'IPTU mensal em reais. Nulo até pré-preencher ou editar.';
comment on column public.locacao_processos.seguro_incendio is
  'Seguro-incêndio mensal em reais. Entra no teste de 3×.';
comment on column public.locacao_processos.seguro_fianca is
  'Seguro-fiança mensal informativo. Fora do teste de 3×. Não obrigatório para FC/Migra.';
comment on column public.locacao_processos.aluguel_origem is
  'superlogica | conversa | manual. Edição humana não é sobrescrita.';

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
       and pg_get_constraintdef(c.oid) like '%relatorio%'
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
    'renda','relatorio','valores_imovel'
  ));

notify pgrst, 'reload schema';
