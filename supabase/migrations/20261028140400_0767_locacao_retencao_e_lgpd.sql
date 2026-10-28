-- manifest: Retenção de 90 dias do processo de locação + encerrar parado em 30 dias + limpeza LGPD por gatilho INVOKER em contacts. A única SECURITY DEFINER é o expurgo, revogada de anon/authenticated.

-- ---- retenção e LGPD do processo de locação (migration 0767, fork) ----

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
    -- Com contrato: só zera fichas/CPF/documentos se a conferência do Drive
    -- não for exigida aqui — a conferência mora no TypeScript (Drive desligado
    -- por padrão; sem Drive, processos SEM contrato apagam; COM contrato o
    -- TypeScript decide). Esta função só limpa o que NÃO é o histórico:
    -- fichas, hashes, ciphertext, linhas de documento já removidas.
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

create or replace function public.fn_expurgar_revisoes_de_vinculo_vencidas(
  p_retencao_dias int default null,
  p_limite int default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dias int := greatest(coalesce(p_retencao_dias, 30), 30);
  v_limite int := least(greatest(coalesce(p_limite, 500), 1), 5000);
  v_corte timestamptz := now() - make_interval(days => v_dias);
  v_n int;
begin
  with vencidas as (
    select id from public.superlogica_vinculo_revisoes
     where estado in ('ligado','nao_ligar','expirado')
       and coalesce(decidido_em, created_at) < v_corte
     order by created_at
     limit v_limite
  )
  delete from public.superlogica_vinculo_revisoes r
   using vencidas v where r.id = v.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.fn_expurgar_revisoes_de_vinculo_vencidas(int, int) from public, anon, authenticated;
grant execute on function public.fn_expurgar_revisoes_de_vinculo_vencidas(int, int) to service_role;

create or replace function public.fn_encerrar_processos_de_locacao_parados(
  p_retencao_dias int default null,
  p_limite int default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dias int := greatest(coalesce(p_retencao_dias, 30), 30);
  v_limite int := least(greatest(coalesce(p_limite, 200), 1), 2000);
  v_corte timestamptz := now() - make_interval(days => v_dias);
  v_n int;
begin
  with parados as (
    select id from public.locacao_processos
     where encerrado_em is null
       and status not in ('contrato_assinado','reprovado','cancelado')
       and status_mudou_em < v_corte
     order by status_mudou_em
     limit v_limite
  )
  update public.locacao_processos p
     set status = 'cancelado',
         motivo_cancelamento = 'expirado',
         motivo_status = 'parado_30d',
         encerrado_em = now(),
         status_mudou_em = now(),
         updated_at = now()
    from parados x
   where p.id = x.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.fn_encerrar_processos_de_locacao_parados(int, int) from public, anon, authenticated;
grant execute on function public.fn_encerrar_processos_de_locacao_parados(int, int) to service_role;

-- LGPD: gatilho INVOKER em contacts. Não edita fn_lgpd_cascade_redact_contact.
create or replace function public.fn_locacao_limpar_contato_anonimizado()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.is_anonymized is true and coalesce(old.is_anonymized, false) is distinct from true then
    update public.locacao_processo_participantes
       set nome_exibicao = null, cpf_hash = null, cpf_mascarado = null,
           cpf_encrypted = null, updated_at = now()
     where organization_id = new.organization_id and contact_id = new.id;

    update public.contato_superlogica_vinculos
       set ativo = false, desfeito_em = now(), motivo_desfeito = 'lgpd'
     where organization_id = new.organization_id and contact_id = new.id and ativo;

    delete from public.superlogica_vinculo_revisoes
     where organization_id = new.organization_id and contact_id = new.id;

    delete from public.locacao_processo_documentos d
     using public.locacao_processo_participantes p
     where d.organization_id = new.organization_id
       and p.organization_id = new.organization_id
       and d.participante_id = p.id
       and p.contact_id = new.id;
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

notify pgrst, 'reload schema';
