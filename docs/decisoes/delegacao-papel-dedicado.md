# Papel Postgres dedicado via Custom Access Token Hook — evidência (não ativado)

**Status:** consolidação. Preparação continua desligada. Nenhum hook configurado,
nenhum papel concedido, nenhum token, nenhum apply, nenhum merge/deploy.

**Pin do kit (CONFIRMADO no repositório):** imagem `supabase/gotrue:v2.196.0`
(`tests/shell/supabase-imagens-plataforma.test.sh`). Tag Git pública
[`v2.196.0`](https://github.com/supabase/auth/releases/tag/v2.196.0) =
commit [`0204331ca41a5b49f076b6fa3dc6c0d20b996590`](https://github.com/supabase/auth/commit/0204331ca41a5b49f076b6fa3dc6c0d20b996590)
no repo open-source [`supabase/auth`](https://github.com/supabase/auth).
**Runtime desta instalação:** não inspecionado (digest da imagem ≠ SHA Git até
alguém puxar o manifesto). Fonte abaixo = Git tag, não o binário em produção.

**Veredito:** isolamento RPC **não está provado**. O enum das docs **não** é a
validação de runtime. `verificarSujeitoOAuth` exigir `role=authenticated` é
**escolha local**, não limite do Auth. Mesmo se o Auth emitir um `role` string
terceiro, PUBLIC / membership / `SET ROLE` / policies `TO authenticated`
continuam. Este PR **não** acrescenta hook, `CREATE ROLE` nem REVOKE global.
Spec 21 (cookie) segue útil sozinha.

---

## Contradição nas docs vs implementação (pública)

Página ao vivo (2026-11-08):
[Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).

| Na mesma página | O que diz |
|---|---|
| JSON Schema de **input** `claims.role` | `"enum": ["anon", "authenticated"]` |
| Exemplo HTTP «Add claim» | `if (claims.app_metadata && claims.app_metadata.role) claims['role'] = claims.app_metadata.role` — valor **arbitrário** de `app_metadata` |
| Prosa | “Claims returned must conform to our specification” |

**INFERIDO a partir das docs sozinhas:** o enum **não prova** que o Auth recusa
`role=oauth_delegado`. O exemplo HTTP contradiz o enum. Não extrapolar o
exemplo nem o nosso verificador para restrição de produto.

---

## Implementação GoTrue v2.196.0 (CONFIRMADO no fonte público)

### Schema que o runtime usa depois do hook

[`internal/tokens/service.go`](https://github.com/supabase/auth/blob/v2.196.0/internal/tokens/service.go)
`MinimumViableTokenSchema` L1019–L1081, aplicado em `validateTokenClaims` L992–L1016
depois de `InvokeHook` (L721–L738):

```json
"role": { "type": "string" }
```

`required`: `aud`, `exp`, `iat`, `sub`, `email`, `phone`, `role`, `aal`,
`session_id`, `is_anonymous`.

`client_id` está em `properties` (L1076–L1078) e **não** em `required`.
Não há `enum` de `role` neste schema.

Struct de claims do hook: [`internal/hooks/v0hooks/v0hooks.go`](https://github.com/supabase/auth/blob/v2.196.0/internal/hooks/v0hooks/v0hooks.go)
L100–L113 — `Role string`, `ClientID string` (`json:"client_id,omitempty"`).

Saída do hook **substitui** as claims: `gotrueClaims = jwt.MapClaims(output.Claims)`
(service.go L738). Hook que omite `client_id` no output **perde** o claim
(INFERIDO do replace; teste oficial não cobre omissão de `client_id`).

### Testes oficiais do hook (CONFIRMADO)

[`internal/api/token_test.go`](https://github.com/supabase/auth/blob/v2.196.0/internal/api/token_test.go)
`TestCustomAccessToken` L697+:

- “Add a new claim” — passa (claim extra).
- “Delete the Role claim” — `shouldError: true` (role **obrigatório** como campo).
- Remove `user_metadata` — passa.
- **Não há** caso que ponha `role` fora de `anon`/`authenticated`.
- Os casos usam `grant_type=refresh_token` no endpoint `/token` **não-OAuth**
  (L803). Não exercitam `/oauth/token` authorization_code.

**Runtime untested:** JWT com `role=oauth_delegado` aceito ou recusado.

Papel default **sem** hook: `Role: params.User.Role` (service.go L711) — em
geral `authenticated` em `auth.users.role` (INFERIDO do produto; não medido
nesta instalação).

### OAuth authorization_code e refresh invocam o mesmo `GenerateAccessToken`

| Passo | Fonte v2.196.0 |
|---|---|
| `POST /oauth/token` `authorization_code` | [`handlers.go`](https://github.com/supabase/auth/blob/v2.196.0/internal/api/oauthserver/handlers.go) L307, L390 `grantParams.OAuthClientID = &client.ID`, L404 `models.OAuthProviderAuthorizationCode`, L416 `IssueRefreshToken` |
| `IssueRefreshToken` passa `ClientID: oAuthClientID` | service.go L921–L934 |
| `GenerateAccessToken` escreve `claims.ClientID` se UUID não nulo | service.go L688–L716 |
| Hook, se `CustomAccessToken.Enabled` | service.go L721–L726 — input = claims **já com** `client_id` + `authentication_method.String()` |
| Método OAuth | [`factor.go`](https://github.com/supabase/auth/blob/v2.196.0/internal/models/factor.go) L103–L104 → `"oauth_provider/authorization_code"` |
| Refresh OAuth | handlers.go L479–L497 `RefreshTokenGrant` com `ClientID` do client autenticado; service.go L293–L301 exige match com `session.OAuthClientID`; L596 `GenerateAccessToken` com esse ClientID; método `"token_refresh"` (factor.go L93–L94) |

**CONFIRMADO no fonte:** com hook **ligado**, authorization_code e refresh
passam pelo hook com `client_id` no **input** (quando a sessão OAuth tem
client). Cookie/password não passa `ClientID` (generateAccessToken em
`internal/api/token.go` não preenche ClientID).

**Runtime untested:** Auth desta instalação com hook enabled; preservação de
`client_id` no **output** do hook; emissão com `role` string terceiro.

Cookie/outros clients: o hook corre em **todo** `GenerateAccessToken` se
Enabled (service.go L721). Isolar cookie exige o hook **não** alterar `role`
quando `client_id` está vazio. Isso é lógica do hook, não default do Auth.
**Não implementado. Não ligado.**

---

## Isolamento Postgres (junto com o claim, não em vez dele)

Mesmo **se** M1 (abaixo) mostrar JWT `role=oauth_delegado` + `sub` + `client_id`:

| Camada | Estado |
|---|---|
| `GRANT … TO PUBLIC` | alcança **todo** papel, inclusive `NOINHERIT`. Papel dedicado **não** isola o que está em PUBLIC. Sintético local: `tests/invariants/delegacao-papel-publico-nao-isola.test.ts` (escrito; **não executado** aqui — Docker ausente; CI pg15/17 no HEAD ainda sem conclusão). |
| `GRANT … TO authenticated` | **não** cai em papel que não é membro. DEFINER volátil do allowlist está em `authenticated` (issue #128; `anon` zerado). |
| `USAGE ON SCHEMA public` | dump: postgres/anon/authenticated/service_role — **não** PUBLIC. Papel novo sem GRANT não entra no schema. |
| PostgREST `authenticator` `SET ROLE` | precisa `GRANT <papel> TO authenticator`. Sem isso o switch falha. |
| Policies `TO authenticated` | papel terceiro **não** as vê; precisa policies `TO` esse papel. |
| “Não mandar JWT ao PostgREST” | **insuficiente.** Bearer chama `/rest/v1` e `/rpc` se a Data API estiver publicada. |

`verificarSujeitoOAuth` recusar `role !== "authenticated"` é **código desta
app**, não o Auth. Dá para mudar depois; **não** é prova de que o Auth recusa.

---

## O que este PR não faz (de propósito)

Nenhum ficheiro de hook SQL, nenhum `CREATE ROLE`, nenhum GRANT a
`authenticator`, nenhum REVOKE global de DEFINER, nenhum rewrite de RPC,
nenhum `pgrst.db_pre_request`. 0773 (tabelas) permanece **não aplicada**.

---

## Próxima medição autorizada (uma, não um menu)

Não há escolha A/B/C que feche RPC sem medição. O que falta e **não cabe** no
Postgres efêmero de `test:db` (não sobe GoTrue):

**M1 — emissão de JWT pelo Auth pinado, ambiente descartável, aprovação
posterior.** Sem isto, não afirmar que o Auth aceita ou recusa `role`
terceiro.

| | |
|---|---|
| **Recurso** | Um Auth descartável da **mesma tag de imagem** `supabase/gotrue:v2.196.0` (ou binário do commit `0204331`) + Postgres só do Auth. **Não** a VPS de cliente. **Não** ligar o hook na instalação viva. |
| **Efeito** | Liga `Hook.CustomAccessToken` **só nesse Auth**. Função/HTTP que **copia** `event.claims` e, se `client_id` presente, põe `claims.role = "oauth_delegado"`; se ausente, devolve claims intactas. Emite 2–3 tokens de teste e apaga o ambiente. Zero GRANT no schema do CRM. Zero client OAuth de produção. |
| **Asserções** | (1) `authorization_code` → JWT com `sub` = user id, `client_id` = client do teste, `role` = `oauth_delegado` **ou** HTTP 500 com erro de schema (os dois resultados são evidência). (2) `refresh_token` do mesmo client: mesmas claims. (3) grant password/cookie no mesmo Auth: `role` continua o de `auth.users` (tipicamente `authenticated`) e **sem** `client_id`. (4) variante: hook que omite `client_id` no output → JWT **sem** `client_id` (replace). |
| **Não é** | CREATE ROLE no CRM, GRANT, policies, PostgREST, Inbox, merge, deploy. |

**M2 só depois de M1 aceitar o claim** (aprovação à parte, blast de schema):
`CREATE ROLE` NOINHERIT, `GRANT TO authenticator`, `USAGE` em `public`,
policies `TO` o papel, inventário PUBLIC restante. **Não agora.**

---

## Spec 21 vs delegação

A exclusão `is_personal === false` nas rotas cookie de mídia/documentos é
independente e continua. Delegação HTTP 404. Sem M1, **não** homologar JWT
OAuth como sujeito confinado na RPC.
