-- Snapshot dos CATÁLOGOS afetados pela 0774. Sem linhas de conversa/mensagem,
-- sem objetos de Storage, sem tokens, sem PII.
-- 0774 não escreve dado de atendimento: reversão = restaurar estes catálogos,
-- não restore indiscriminado de DB/Storage.
--
-- Uso (harness): \t on  +  copy (select ...) to stdout.
select jsonb_build_object(
  'roles', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'rolname', r.rolname,
      'rolinherit', r.rolinherit,
      'rolcanlogin', r.rolcanlogin
    ) order by r.rolname), '[]'::jsonb)
    from pg_roles r
    where r.rolname in ('oauth_delegado', 'authenticated', 'anon', 'authenticator')
  ),
  'membership_authenticator_oauth', (
    select exists (
      select 1 from pg_auth_members m
      join pg_roles r on r.oid = m.roleid
      join pg_roles u on u.oid = m.member
      where r.rolname = 'oauth_delegado' and u.rolname = 'authenticator'
    )
  ),
  'rls_storage_objects', (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects'
  ),
  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname,
      'table', c.relname,
      'name', p.polname,
      'cmd', p.polcmd,
      'roles', (
        select coalesce(array_agg(pr.rolname order by pr.rolname), array[]::name[])
        from pg_roles pr
        where pr.oid = any (p.polroles)
      ),
      'using', pg_get_expr(p.polqual, p.polrelid),
      'check', pg_get_expr(p.polwithcheck, p.polrelid)
    ) order by n.nspname, c.relname, p.polname), '[]'::jsonb)
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where (n.nspname = 'public' and c.relname in (
            'conversations', 'messages', 'contacts',
            'locacao_processo_conversas', 'locacao_processo_documentos',
            'delegacao_visibilidade_corporativa',
            'delegacao_sessoes_empresariais',
            'delegacao_contas_empresariais',
            'delegacao_clientes_autorizados'
          ))
       or (n.nspname = 'storage' and c.relname = 'objects'
           and p.polname in (
             'tenant_read_ai_policy', 'tenant_write_ai_policy', 'tenant_delete_ai_policy',
             'tenant_read_lgpd_exports',
             'propostas: leitura por organizacao',
             'locacao-processos: leitura por organizacao',
             'storage_objects_select_oauth_delegado'
           ))
  ),
  'acl', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'rel', format('%I.%I', n.nspname, c.relname),
      'oauth_select', has_table_privilege('oauth_delegado', format('%I.%I', n.nspname, c.relname), 'select'),
      'oauth_insert', has_table_privilege('oauth_delegado', format('%I.%I', n.nspname, c.relname), 'insert'),
      'oauth_truncate', has_table_privilege('oauth_delegado', format('%I.%I', n.nspname, c.relname), 'truncate'),
      'authenticated_select', has_table_privilege('authenticated', format('%I.%I', n.nspname, c.relname), 'select'),
      'anon_select', has_table_privilege('anon', format('%I.%I', n.nspname, c.relname), 'select')
    ) order by n.nspname, c.relname), '[]'::jsonb)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname in (
        'conversations', 'messages', 'contacts',
        'locacao_processo_conversas', 'locacao_processo_documentos'
      )
  ),
  'funcoes', (
    select coalesce(jsonb_agg(p.proname order by p.proname), '[]'::jsonb)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'fn_delegacao_access_token_hook',
        'fn_delegacao_grant_vivo',
        'fn_delegacao_sessao_empresarial',
        'fn_delegacao_contato_corporativo'
      )
  )
) as catalogo;
