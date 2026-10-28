-- manifest: Vínculo contato ↔ Superlógica no lado do contato (Fase 3, enche na 3.5). Um ativo por contato; histórico ao desligar. RLS por organization_id; sem SECURITY DEFINER.

-- ---- contato_superlogica_vinculos (migration 0764, fork) ----

create table if not exists public.contato_superlogica_vinculos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  superlogica_pessoa_id text not null check (superlogica_pessoa_id ~ '^\d+$'),
  tipos text[] not null default '{}',
  origem text not null check (origem in ('manual','contrato_confirmar','casamento_telefone')),
  qualidade text check (qualidade in ('exato','sem_9','ddd_presumido')),
  ativo boolean not null default true,
  vinculado_por uuid references auth.users(id) on delete set null,
  vinculado_em timestamptz not null default now(),
  desfeito_por uuid references auth.users(id) on delete set null,
  desfeito_em timestamptz,
  motivo_desfeito text check (motivo_desfeito in ('errado','numero_mudou','lgpd','outro')),
  execucao_id uuid,
  created_at timestamptz not null default now(),
  constraint contato_superlogica_vinculos_tipos_ck check (
    tipos <@ array['locatario','fiador','proprietario']::text[]
  )
);

create unique index if not exists contato_superlogica_vinculos_org_contato_ativo_uidx
  on public.contato_superlogica_vinculos (organization_id, contact_id)
  where ativo;
create index if not exists contato_superlogica_vinculos_org_pessoa_ativo_idx
  on public.contato_superlogica_vinculos (organization_id, superlogica_pessoa_id)
  where ativo;

comment on table public.contato_superlogica_vinculos is
  'Id da pessoa na Superlógica no contato. Sem telefone, nome ou CPF. Desligar marca ativo=false.';

alter table public.contato_superlogica_vinculos enable row level security;

drop policy if exists tenant_isolation_contato_superlogica_vinculos_select on public.contato_superlogica_vinculos;
create policy tenant_isolation_contato_superlogica_vinculos_select on public.contato_superlogica_vinculos
  for select using (organization_id in (select public.fn_user_org_ids()));

revoke all on public.contato_superlogica_vinculos from public, anon, authenticated;
grant select on public.contato_superlogica_vinculos to authenticated;
grant all on public.contato_superlogica_vinculos to service_role;

notify pgrst, 'reload schema';
