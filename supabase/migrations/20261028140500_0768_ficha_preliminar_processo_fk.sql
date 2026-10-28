-- manifest: Liga locacao_fichas_preliminares.processo_id à tabela de processos (FK opcional) e índice de documentos do Drive. Sem SECURITY DEFINER nova.

-- ---- ponte ficha preliminar → processo (migration 0768, fork) ----

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'locacao_fichas_preliminares_processo_fk'
  ) then
    alter table public.locacao_fichas_preliminares
      add constraint locacao_fichas_preliminares_processo_fk
      foreign key (processo_id) references public.locacao_processos(id) on delete set null;
  end if;
end $$;

create index if not exists locacao_fichas_preliminares_processo_idx
  on public.locacao_fichas_preliminares (organization_id, processo_id)
  where processo_id is not null;

comment on column public.locacao_fichas_preliminares.processo_id is
  'Processo de locação da Fase 3, quando a ficha preliminar foi ligada. Nulo continua válido.';

notify pgrst, 'reload schema';
