# Papel Postgres dedicado (oauth_delegado) — schema no produto, Auth desligado na instalação

**Status:** schema, policies, HTTP MCP individual e cadastro de vínculo no CRM (migration 0774).
**Não ligado:** Custom Access Token Hook no Auth da instalação, grant/client/conta semeados,
merge/deploy deste documento como ativação.

Escopo: leitura (buscar / ler / baixar) de conversas e anexos da **conta empresarial**
da organização, por identidade OAuth **individual** (JWT `sub` = usuário do CRM). Pessoal
excluído. Números atuais, futuros e substituídos herdam pelo vínculo da sessão com a
conta — não por lista fixa de telefone nem por confirmação a cada troca. Não usa chave
de organização, cookie de outra sessão, nem JWT assinado nesta app.

WhatsApp é **fonte** de documento. O canal do Bot é HTTP `/api/mcp/delegacao`, isolado
de `/api/mcp` (dsk_ + admin).

## O que o código faz (CONFIRMADO)

| Peça | Onde |
|---|---|
| `CREATE ROLE oauth_delegado NOINHERIT` + `GRANT … TO authenticator` | migration 0774 / apêndice do baseline |
| Hook `fn_delegacao_access_token_hook` | **allowlist vazia** (zero linhas vivas) = copia claims, `role` permanece `authenticated`; **não-vazia** = `client_id` vivo vira `oauth_delegado`. Ligar o hook no Auth **não** desfaz recast PUBLIC→authenticated nem RLS de storage |
| `delegacao_clientes_autorizados` | allowlist de client_id + `hook_version`; vazia |
| `delegacao_visibilidade_corporativa` | grant uid+client+org + efeitos `buscar/ler/baixar`; vazia; RLS SELECT só `TO oauth_delegado` |
| `delegacao_contas_empresariais` | conta empresarial da org; sem telefone, sem PII, sem semente |
| `delegacao_sessoes_empresariais` | vínculo sessão→conta, gravado no cadastro administrativo da conexão. Vazio/revogado = recusa |
| `fn_delegacao_sessao_empresarial` | DEFINER estável: sessão vinculada a conta viva da mesma org. Não olha status, created_by, nome, telefone, WORKING |
| Policies `TO oauth_delegado` | `conversations`, `messages`, `contacts`, `locacao_processo_*`, `storage.objects` |
| Cookie | USING das policies de SELECT nas tabelas concedidas ao papel é o mesmo; só ganham `TO authenticated` |
| HTTP | `GET/POST /api/mcp/delegacao` + RFC 9728 `/.well-known/oauth-protected-resource[/api/mcp/delegacao]` |
| Cadastro | `PUT/DELETE /api/v1/channel-sessions/:id/conta-empresarial` (admin + suporte de escrita). POST que cria o número **não** classifica |
| Verifier | `verificarSujeitoOAuth` exige `role=oauth_delegado` + `client_id`; recusa `dsk_` e cookie |
| TRUNCATE | `REVOKE ALL` do papel; RLS **não** governa TRUNCATE |
| Pre-request PostgREST | `GRANT EXECUTE` em `fn_pgrst_recusar_replay_do_gateway` — o hook `pgrst.db_pre_request` corre como o papel do JWT; sem isso a cadeia HTTP morre em 42501 antes da RLS. Não amplia dado corporativo |

0773 experimental (oauth_cookie_only em toda tabela `public`) **não** entra aqui.

## Classificação de origem (CONFIRMADO — requisito de produto)

Permissão de leitura delegada mora no **grant individual** (uid+client+org) sobre a
**conta empresarial**. Não é allowlist estática de pessoa, nem lista de telefone.

- Inclusão ou substituição de sessão: o cadastro administrativo da conexão grava o
  vínculo `channel_session_id → conta_empresarial_id`. A sessão nova **herda**.
- Pessoal / desconhecida: **nunca** herda. Sem vínculo = recusa, mesmo com
  `contacts.is_personal is false`, `status=WORKING`, `organization_id` da org,
  `created_by` ou nome da sessão.
- Tenancy que mistura pessoal precisa do vínculo explícito e do fluxo administrativo
  na conexão — não de um ok por telefone.
- O vínculo atual em produção é **levantamento administrativo separado**. Este corte
  não presume números, sessões nem identidades. Fixtures de teste são sintéticas.

## Auth runtime

**CONFIRMADO (instalação, 08/11 17:04 São Paulo):** `GET /auth/v1/health` HTTP 200 com a
publishable key devolveu GoTrue **v2.197.0**. Tag pública
`v2.197.0` (git SHA `4eee58f296d9698a1c2c0ae14d7a0b379c7622d3`). Não é o digest
gerenciado nem a tag `v2.196.0` usada num harness anterior.

Changelog público v2.196.0 → v2.197.0 (não assumir digest): códigos de recuperação MFA;
metering OAuth na troca de token; OTP `expires_at`; tabelas SCIM. Contrato do Custom
Access Token Hook: **CONFIRMADO** na cadeia viva (role continua string, não enum;
HTTP hook `v1,whsec_` + `host.docker.internal`; PKCE com consent API, não UI).

O hook SQL deste PR **não está ligado** no Auth da instalação. Ligá-lo é
`GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN` apontando para `fn_delegacao_access_token_hook` (ou
URI HTTP equivalente), config do Auth, não variável de `lib/env.ts`.

**Consent / token revoke (CONFIRMADO no harness vivo, GoTrue v2.197.0):**
`POST /oauth/revoke` (RFC 7009, `token_type_hint=refresh_token`) e `POST /logout`
negam o **refresh** seguinte. O access JWT permanece válido até `exp` em PostgREST
e no GET de bytes da Storage API — JWT stateless, sem denylist de access neste
corte. `delegacao_visibilidade_corporativa.revoked_at` nega SELECT e GET de bytes
**na hora**, com o mesmo JWT ainda válido. Não confundir revoke de token Auth com
revoke de grant CRM.

## Recast PUBLIC → authenticated (CONFIRMADO)

Policies de SELECT das tabelas concedidas ao papel nasciam sem `TO` (vale para PUBLIC,
incluindo `oauth_delegado` mesmo NOINHERIT). Foram recortadas `TO authenticated`.
Inventário na 0774: `conversations_select`, `messages_select`,
`tenant_isolation_contacts_read`, write de contacts partido em insert/update/delete,
locação processo conversas/documentos, storage `tenant_read_ai_policy` /
`tenant_write_ai_policy` / `tenant_delete_ai_policy` / `tenant_read_lgpd_exports` /
`propostas: leitura por organizacao` / `locacao-processos: leitura por organizacao`.

Não havia policy `TO anon` nesses objetos; `anon` permanece pelo ACL que já tinha.
Empty hook/grants **não** desfazem o recast nem a RLS de `storage.objects`.

## Recuperação / rollback (CONFIRMADO)

0774 **não escreve** dado de conversa nem objeto de Storage. `agent.sh` / troca de
imagem **não** reverte banco.

Reversão = restaurar os **catálogos** afetados (policies, ACL, membership, RLS ligada,
hook) **e**, se o hook tiver sido ligado à parte, a config do Auth **antes** de
qualquer reativação (`supabase/rollback/0774_auth_config.md`: desligar a flag do
hook, repor ENABLED/URI do snapshot de chaves, **não ler/exibir**
`GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS`, recarregar só o processo Auth). Ensaio:
`supabase/rollback/0774_delegacao_papel_dedicado.sql` + snapshot
`supabase/rollback/0774_snapshot_catalogo.sql`. Equivalência: catálogo **pré-0774**
== primeiro rollback (exceto ratchet: `storage.objects` RLS permanece ON se a 0774
ligou; desligar seria mudar o produto). Reaplicar 0774 == catálogo com-0774.
Restore de imagem / `agent.sh` **não** é restore de banco. Restore indiscriminado
de DB/Storage **não** é o ensaio.

Backups gerenciados da instalação: **não verificados** com o conector atual. Não se
conclui que estão ausentes. Rollout de DB na instalação espera prova de recuperação
à parte.

## Implantação (coordenação — sem PII)

Consultas sem dado pessoal, no banco da instalação, **depois** de backup de catálogo:

1. `select rolname, rolinherit from pg_roles where rolname = 'oauth_delegado';`
2. `select pg_has_role('authenticator', 'oauth_delegado', 'member');`
3. `select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relname='objects';`
4. `select has_table_privilege('oauth_delegado','public.conversations','truncate');` — esperado `f`
5. Auth: hook **não** ligado até decisão de ativação.

**Consentimento / login da pessoa:** o grant só pode ser inserido com o `sub` dela no
Auth desta instalação. Este corte **não** envia mensagem a ela nem a terceiros.
Identificadores não se inferem do nome do client. Vínculo de sessões da instalação
é levantamento administrativo, não semente deste PR.
