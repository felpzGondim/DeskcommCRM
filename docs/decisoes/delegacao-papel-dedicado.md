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
| Client JWT | `createUserClientFromAccessToken` usa `accessToken` do SDK (PostgREST/Storage). `createAnonAuthLeitor` é o getUser — o mesmo client com `accessToken` **não** expõe `auth` |
| Cadastro | `PUT/DELETE /api/v1/channel-sessions/:id/conta-empresarial` (admin + suporte de escrita). POST que cria o número **não** classifica |
| Verifier | `verificarSujeitoOAuth` exige `role=oauth_delegado` + `client_id`; recusa `dsk_` e cookie |
| TRUNCATE | `REVOKE ALL` do papel; RLS **não** governa TRUNCATE |
| Pre-request PostgREST | `GRANT EXECUTE` em `fn_pgrst_recusar_replay_do_gateway` — o hook `pgrst.db_pre_request` corre como o papel do JWT; sem isso a cadeia HTTP morre em 42501 antes da RLS. Não amplia dado corporativo |
| Grant vivo | `fn_delegacao_grant_vivo` lê `request.jwt.claims` (GUC do PostgREST). `auth.uid()`/`auth.jwt()` dentro da função INVOKER com `search_path=public` é 42501 schema auth no SELECT de conversations |
| Storage GRANT | USAGE no schema `storage` **e** SELECT em `storage.objects` para `oauth_delegado`. `delegacao-storage-ativar.sql` concede o mínimo como o aplicador atual e aborta se `has_schema_privilege`/`has_table_privilege` não ficarem — sem SET ROLE, sem exigir o nome do dono. **CRM gerenciado** (pré-flight 09/11 23:56 São Paulo): `postgres` NOSUPERUSER INHERIT LOGIN, não membro dos owners (`storage`=`supabase_admin`, objects/buckets=`supabase_storage_admin`), mas USAGE e SELECT **com GRANT OPTION** — o conector administrativo existente concede; sem `SUPABASE_DB_ADMIN_URL` nova. **Stack e2e local** (`supabase/postgres:15.8.1.085`): o mesmo `postgres` **não** tem GRANT OPTION; o apply é inerte (WARNING) e o e2e corre o script como `supabase_admin` que o stack já tem. Sem escrita (INSERT/UPDATE/DELETE/TRUNCATE). |

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

O processo Next do Bot (`/api/mcp/delegacao`) **não** reescreve path. `proxy.ts`
trata `/api/mcp/delegacao` como público (Bearer chega; cookie não autentica essa
superfície). O verifier recusa `dsk_` e `role=authenticated`. GET 401 / well-known
200 / cookie 401 **não** provam tools/call. tools/call atravessa Auth `getUser` +
PostgREST (SET ROLE `oauth_delegado`) + Storage; o client de dado usa
`accessToken` do SDK, senão o fetch cai na anon key e a RLS recusa.

**Issuer / RFC 9728 (CONFIRMADO — felpz.19):** `authorization_servers` e a
conferência do `iss` do JWT saem de `env.NEXT_PUBLIC_SUPABASE_URL` (`lib/env`,
parse do objeto `process.env` em runtime), o mesmo caminho que o client de
servidor e `jwt-usuario` já usam. Acesso literal `process.env` +
`NEXT_PUBLIC_SUPABASE_URL` é inlined no build da imagem genérica
(`ARG` `https://placeholder.supabase.co`) e **não** vale. Placeholder ou
ausência → `authorization_servers` vazio e JWT recusado (fail-closed).
`SUPABASE_SERVER_URL` é só transporte interno (Kong); não entra no issuer.

**Tela de consentimento (CONFIRMADO — felpz.19):** path `/oauth/consent`
(`CAMINHO_CONSENTIMENTO_OAUTH`). O Auth redireciona com `?authorization_id=`.
Exige sessão cookie do CRM (não está em `PUBLIC_PATHS`; o proxy manda a
`/login?next=`). Aprovar/negar = `auth.oauth.approveAuthorization` /
`denyAuthorization` (`skipBrowserRedirect`). Configurar no Dashboard:
`authorization_url_path` = `/oauth/consent`.

**Consent / token revoke (CONFIRMADO no harness vivo, GoTrue v2.197.0):**
`POST /oauth/revoke` (RFC 7009, `token_type_hint=refresh_token`) e `POST /logout`
negam o **refresh** seguinte. O access JWT permanece válido até `exp` em PostgREST
e no GET de bytes da Storage API — JWT stateless, sem denylist de access neste
corte. **Não inventar logout que mate o access token.** Efeito instantâneo =
`delegacao_visibilidade_corporativa.revoked_at` (o mesmo JWT ainda válido passa
a ser 404 no MCP e RLS recusa SELECT/bytes). Revoke Auth e revoke de grant CRM
são eixos distintos.

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
ligou; desligar seria mudar o produto). Reaplicar 0774 **e**
`delegacao-storage-ativar.sql` == catálogo com-0774 (a 0774 sozinha no molde
sem GRANT OPTION deixa SELECT de storage inerte). Rollback revoga também USAGE
e SELECT da ativação.
Restore de imagem / `agent.sh` **não** é restore de banco. Restore indiscriminado
de DB/Storage **não** é o ensaio.

Pré-flight live: **três inventários independentes** — (1) catálogo SQL pré/pós
0774, (2) chaves Auth ENABLED/URI (nunca secrets), (3) grants CRM `revoked_at`.
Um não substitui o outro. Conferir catálogo igual ao snapshot **não** prova
config Auth nem efeito de revoke.

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
