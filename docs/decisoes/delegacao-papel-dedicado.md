# Papel Postgres dedicado via Custom Access Token Hook — evidência (não ativado)

**Status:** M1/M2 medidos no descartável (2026-11-08). Produto continua
desligado. Nenhum hook/papel/token/apply no CRM. Sem merge/deploy.

**Pin do kit (CONFIRMADO no repositório):** imagem `supabase/gotrue:v2.196.0`
(`tests/shell/supabase-imagens-plataforma.test.sh`). Tag Git pública
[`v2.196.0`](https://github.com/supabase/auth/releases/tag/v2.196.0) =
commit [`0204331ca41a5b49f076b6fa3dc6c0d20b996590`](https://github.com/supabase/auth/commit/0204331ca41a5b49f076b6fa3dc6c0d20b996590)
no repo open-source [`supabase/auth`](https://github.com/supabase/auth).
**Runtime desta instalação:** não inspecionado (digest da imagem ≠ SHA Git até
alguém puxar o manifesto). Fonte abaixo = Git tag, não o binário em produção.

**Veredito:** o Auth pinado **emite** `role=oauth_delegado` (M1 12/12). Isolamento
RPC no **produto** continua **não ligado**. PUBLIC alcança NOINHERIT; policies
`TO authenticated` não cobrem o papel terceiro; authenticator precisa de GRANT.
`verificarSujeitoOAuth` exigir `authenticated` é escolha local. Spec 21 (cookie)
independente. HTTP 404.

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

**Runtime MEDIDO** (VM descartável 2026-11-08, não produção): JWT com
`role=oauth_delegado` **foi emitido** pelo binário compilado de `0204331`
(12/12 no harness). Ver `docs/evidencias/delegacao-m1-m2-vm-2026-11-08.md`.

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

**Runtime MEDIDO** no Auth descartável (não nesta instalação viva): hook
enabled só nesse processo; `client_id` copiado no output quando o hook não
omite; `role=oauth_delegado` só no `client_id` mapeado; omitir `client_id`
no output remove o claim (replace). Cookie/password sem `client_id`,
`role=authenticated`.

Cookie/outros clients: o hook corre em **todo** `GenerateAccessToken` se
Enabled (service.go L721). Isolar cookie exige o hook **não** alterar `role`
quando `client_id` está vazio. Isso é lógica do hook, não default do Auth.
**Não implementado. Não ligado.**

---

## Isolamento Postgres (junto com o claim, não em vez dele)

Mesmo **se** M1 (abaixo) mostrar JWT `role=oauth_delegado` + `sub` + `client_id`:

| Camada | Estado |
|---|---|
| `GRANT … TO PUBLIC` | alcança **todo** papel, inclusive `NOINHERIT`. Papel dedicado **não** isola o que está em PUBLIC. **MEDIDO** no sintético (`m2.public_execute_reaches_dedicated`) e nos invariantes CRM `delegacao-papel-publico-nao-isola.test.ts` (27/27 no Postgres 16 local). |
| `GRANT … TO authenticated` | **não** cai em papel que não é membro. DEFINER volátil do allowlist está em `authenticated` (issue #128; `anon` zerado). |
| `USAGE ON SCHEMA public` | dump: postgres/anon/authenticated/service_role — **não** PUBLIC. Papel novo sem GRANT não entra no schema. |
| PostgREST `authenticator` `SET ROLE` | precisa `GRANT <papel> TO authenticator`. Sem isso o switch falha. |
| Policies `TO authenticated` | papel terceiro **não** as vê; precisa policies `TO` esse papel. |
| “Não mandar JWT ao PostgREST” | **insuficiente.** Bearer chama `/rest/v1` e `/rpc` se a Data API estiver publicada. |

`verificarSujeitoOAuth` recusar `role !== "authenticated"` é **código desta
app**, não o Auth. Dá para mudar depois; **não** é prova de que o Auth recusa.

---

## O que este PR não faz no produto (de propósito)

Nenhum hook no baseline, nenhum `CREATE ROLE` no CRM, nenhum GRANT a
`authenticator` na instalação viva, nenhum REVOKE global de DEFINER, nenhum
rewrite de RPC, nenhum `pgrst.db_pre_request`. 0773 (tabelas) permanece
**não aplicada** no banco do cliente. HTTP 404. Harness em
`scripts/disposable-delegacao-auth/` é só a VM de teste.

---

## Medição M1+M2 (VM descartável 2026-11-08)

Autorização Felipe (Análise pos2792–2793): ambiente temporário isolado,
dados fictícios, sem produção. Harness:
`scripts/disposable-delegacao-auth/run.sh`. Evidência:
`docs/evidencias/delegacao-m1-m2-vm-2026-11-08.md`.

| Faixa | Resultado |
|---|---|
| **M1** GoTrue `0204331` + PKCE + refresh | **12/12 PASS.** `role=oauth_delegado` só no client mapeado; outro client e password `authenticated` sem `client_id`; omitir `client_id` no output remove o claim; `jose` + `getClaims`/`getUser`. |
| **M2** SQL sintético (papel dedicado) | **25/25 PASS.** PUBLIC alcança NOINHERIT; authenticator SET ROLE recusa sem GRANT (`SET SESSION AUTHORIZATION`); policies TO `oauth_delegado` + policy no grant; recusa pessoal/unknown/outra org/client/revogado; documents/storage/write deny; cookie intacta. |
| **M2** invariantes CRM (`delegacao-*.test.ts` no baseline local pg16) | **27/27 PASS** (3 files). `storage.objects` neste stub **não** tem RLS (`false`) — 0773 **não** cria `oauth_cookie_only` lá (condicional a `relrowsecurity`). |
| **Produto** | Inalterado: 404, flag off, 0773 unapplied, sem hook. |

**Não homologar RPC do produto.** M1 prova que o Auth *pode* emitir o papel;
M2 prova o isolamento *se* o CRM ganhar o papel + policies + GRANT
authenticator + revogação de PUBLIC. Nada disso está ligado.

---

## Spec 21 vs delegação

A exclusão `is_personal === false` nas rotas cookie de mídia/documentos é
independente e continua. Delegação HTTP 404. M1/M2 medidos no descartável
**não** ligam o produto. `verificarSujeitoOAuth` ainda exige
`role=authenticated` (escolha local): um Bearer `oauth_delegado` seria
recusado por essa função mesmo com o Auth a emití-lo.
