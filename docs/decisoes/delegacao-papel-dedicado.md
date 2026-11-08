# Papel Postgres dedicado (oauth_delegado) — schema no produto, Auth desligado

**Status:** schema e policies no CRM (migration 0774). Hook SQL versionado existe.
**Não ligado:** Custom Access Token Hook no Auth da instalação, HTTP de delegação,
grant/client semeados, merge/deploy deste documento como ativação.

Escopo: leitura de conversas e anexos **empresariais** (`contacts.is_personal is false`)
por identidade OAuth **individual** (JWT `sub` = usuário do CRM). Pessoal excluído.
Não usa chave de organização, cookie de outra sessão, nem JWT assinado nesta app.

## O que o código faz (CONFIRMADO)

| Peça | Onde |
|---|---|
| `CREATE ROLE oauth_delegado NOINHERIT` + `GRANT … TO authenticator` | migration 0774 / apêndice do baseline |
| Hook `fn_delegacao_access_token_hook` | client_id na allowlist → `role=oauth_delegado`; sem client_id permanece `authenticated` |
| `delegacao_clientes_autorizados` | allowlist de client_id + `hook_version`; vazia |
| `delegacao_visibilidade_corporativa` | grant uid+client+org; vazia; RLS SELECT só `TO oauth_delegado` com `user_id = auth.uid()` |
| Policies `TO oauth_delegado` | `conversations`, `messages`, `contacts`, `locacao_processo_*`, `storage.objects` |
| Cookie | USING das policies de SELECT nas tabelas concedidas ao papel é o mesmo; só ganham `TO authenticated` para não valerem no papel dedicado |
| Verifier | `verificarSujeitoOAuth` exige `role=oauth_delegado` + `client_id`; recusa `dsk_` e cookie |
| TRUNCATE | `REVOKE ALL` do papel; RLS **não** governa TRUNCATE; `FOR ALL` de policy **não** cobre |

0773 experimental (oauth_cookie_only em toda tabela `public`) **não** entra aqui.

## Auth runtime (já medido no descartável, M1)

GoTrue v2.196.0 (fonte público, tag `v2.196.0`) valida `role` como string, não enum
`anon|authenticated`. Com hook enabled, authorization_code+PKCE emitiu
`role=oauth_delegado` no ambiente descartável (12/12). **Esta instalação** não tem
o hook ligado. O teste do hook neste PR chama a função SQL; não substitui o Auth
vivo até o operador apontar `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN` para
`fn_delegacao_access_token_hook`.

## Implantação (coordenação — sem PII)

Consultas sem dado pessoal, no banco da instalação, **depois** de backup:

1. `select rolname, rolinherit from pg_roles where rolname = 'oauth_delegado';`
2. `select pg_has_role('authenticator', 'oauth_delegado', 'member');`
3. `select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relname='objects';`
4. `select has_table_privilege('oauth_delegado','public.conversations','truncate');` — esperado `f`
5. Auth: hook **não** ligado até decisão de ativação. Flag do OAuth Server do Auth
   é config do Auth, não variável de `lib/env.ts`.

**Consentimento / login da pessoa:** o grant (`user_id` + `oauth_client_id` + org)
só pode ser inserido com o `sub` dela no Auth desta instalação. Isso depende do
login (e do consentimento OAuth) **dela**. Este corte **não** envia mensagem a
ela nem a terceiros. Identificadores não se inferem do nome do client.

Rollback: `revoke oauth_delegado from authenticator;` e não ligar o hook. As
tabelas/policies ficam inertes (allowlist e grants vazios = zero linhas).
