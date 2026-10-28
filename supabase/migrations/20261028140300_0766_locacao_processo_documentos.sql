-- manifest: Fase 3b: documentos do processo + bucket privado locacao-processos. Drive e VPS atrás de chave desligada. RLS por organization_id; sem apagar pela sessão.

-- ---- documentos do processo (migration 0766, fork, Fase 3b) ----
-- Padrões sujeitos à revisão do Felipe (perguntas 1–12 = a).
-- Drive DESLIGADO por padrão. Credencial só em variável de ambiente, nunca no Git.

create table if not exists public.locacao_processo_documentos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  processo_id uuid not null references public.locacao_processos(id) on delete cascade,
  participante_id uuid references public.locacao_processo_participantes(id) on delete set null,
  categoria text not null check (categoria in (
    'documento_pessoal','comprovante_renda','laudo_fc','cotacao_seguro','relatorio','contrato','outro'
  )),
  storage_path text not null,
  mime text not null,
  tamanho_bytes bigint not null check (tamanho_bytes > 0 and tamanho_bytes <= 20971520),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  md5 text check (md5 ~ '^[0-9a-f]{32}$'),
  origem text not null check (origem in (
    'anexo_conversa','upload_manual','hub_fc','hub_migra','relatorio'
  )),
  mensagem_id uuid,
  drive_status text not null default 'nao_se_aplica' check (drive_status in (
    'nao_se_aplica','pendente','copiado','falhou'
  )),
  drive_file_id text,
  drive_copiado_em timestamptz,
  drive_md5 text,
  drive_tentativas int not null default 0,
  drive_proxima_em timestamptz,
  drive_erro_codigo text,
  vps_status text not null default 'nao_se_aplica' check (vps_status in (
    'nao_se_aplica','pendente','copiado','falhou'
  )),
  vps_sha256 text,
  vps_copiado_em timestamptz,
  removido_em timestamptz,
  removido_por uuid references auth.users(id) on delete set null,
  motivo_remocao text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint locacao_processo_documentos_path_ck check (
    storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/processos/'
  )
);

create index if not exists locacao_processo_documentos_proc_idx
  on public.locacao_processo_documentos (organization_id, processo_id)
  where removido_em is null;
create index if not exists locacao_processo_documentos_drive_pendente_idx
  on public.locacao_processo_documentos (organization_id, drive_proxima_em)
  where drive_status = 'pendente';

comment on table public.locacao_processo_documentos is
  'Arquivos do processo no bucket locacao-processos. Caminho sem nome/CPF/telefone.';

alter table public.locacao_processo_documentos enable row level security;

drop policy if exists tenant_isolation_locacao_processo_documentos_select on public.locacao_processo_documentos;
create policy tenant_isolation_locacao_processo_documentos_select on public.locacao_processo_documentos
  for select using (organization_id in (select public.fn_user_org_ids()));

revoke all on public.locacao_processo_documentos from public, anon, authenticated;
grant select on public.locacao_processo_documentos to authenticated;
grant all on public.locacao_processo_documentos to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'locacao-processos',
  'locacao-processos',
  false,
  20971520,
  array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do nothing;

drop policy if exists "locacao-processos: leitura por organizacao" on storage.objects;
create policy "locacao-processos: leitura por organizacao" on storage.objects
  for select using (
    bucket_id = 'locacao-processos'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    and (split_part(name, '/', 1))::uuid in (select public.fn_user_org_ids())
  );

notify pgrst, 'reload schema';
