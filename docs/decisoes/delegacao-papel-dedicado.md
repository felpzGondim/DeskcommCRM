# Papel Postgres dedicado via Custom Access Token Hook — avaliação (STOP)

**Status:** consolidação **antes** de mais RLS. Preparação continua desligada.
Nenhum hook configurado, nenhum papel concedido, nenhum token, nenhum apply.
Lido em 2026-11-08 nas páginas oficiais (não é memória de modelo).

**Veredito:** isolamento RPC por papel dedicado **não** é arquitetura suportada
com o Auth atual. Este PR **não** acrescenta hook, `CREATE ROLE` nem
`REVOKE` global. A spec 21 (cookie) segue útil sozinha.

---

## O que as docs oficiais comprovam

### Custom Access Token Hook

Fonte: [Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).

- O hook corre **antes** de todo access token (cookie, OAuth, refresh).
- Claims devolvidas **têm** de passar na especificação do Auth; senão o Auth
  **erra** e não emite o token.
- No JSON Schema publicado, `claims.role` é `"enum": ["anon", "authenticated"]`.
- `sub` / `user_id` entram no input; o exemplo oficial **não** os troca.
- Input de OAuth inclui `claims.client_id`. `authentication_method` inclui
  `oauth_provider/authorization_code` e `token_refresh`.
- Exemplos oficiais de “admin” põem flag em `app_metadata`, **não** um papel
  Postgres novo. O exemplo HTTP que copia `app_metadata.role` para
  `claims.role` só sobrevive se o valor continuar `anon`|`authenticated`.

**CONFIRMADO:** o hook oficial **não** pode emitir `role=oauth_delegado`.
Cookie e outros clients continuam `authenticated` se o hook só acrescentar
claims quando `client_id` está presente — mas isso **não** muda o papel
Postgres do JWT OAuth.

### OAuth 2.1 Server + RLS

Fontes: [OAuth 2.1 Server](https://supabase.com/docs/guides/auth/oauth-server),
[Token security](https://supabase.com/docs/guides/auth/oauth-server/token-security),
[Getting started](https://supabase.com/docs/guides/auth/oauth-server/getting-started).

- Access token OAuth **é** JWT padrão: `role: "authenticated"`, `aud:
  "authenticated"`, `sub`, `client_id`.
- RLS oficial diferencia OAuth por `auth.jwt() ->> 'client_id'`, inclusive
  restritiva `client_id IS NULL` (é o padrão que a 0773 já usa em tabelas).
- Escopos OIDC **não** controlam o banco.
- Hook aplica a tokens OAuth para **claims extras** (`aud`, metadado), não
  para papel Postgres terceiro.
- Teste oficial: `SET request.jwt.claims = '{..., "role":"authenticated",
  "client_id":"..."}'` — o papel permanece `authenticated`.

**CONFIRMADO:** o contrato suportado é JWT `authenticated` + `client_id` na
RLS. Não há caminho documentado “SET ROLE oauth_delegado” no Auth.

### Este repositório (SDK / PostgREST)

- `verificarSujeitoOAuth` recusa `claims.role !== "authenticated"`
  (`lib/auth/delegacao-oauth-sujeito.ts`). Um JWT com papel dedicado seria
  recusado **pela app** mesmo que o Auth o emitisse.
- `aud` tem de ser exatamente `"authenticated"` (não URL RFC 8707). Hook que
  personaliza `aud` para o client **quebra** este verificador.
- Cookie: `createClient` de sessão; JWT sem `client_id`.
- PostgREST: `authenticator` faz `SET ROLE` para o claim `role`. Papéis
  conhecidos no dump: `anon`, `authenticated`, `service_role`. `GRANT USAGE
  ON SCHEMA public` vai a esses três + `postgres`, **não** a `PUBLIC` nem a
  um quarto papel. Sem `GRANT <papel> TO authenticator`, o switch falha.

---

## PUBLIC, NOINHERIT e default privileges (Postgres, não Auth)

Mesmo **se** o Auth emitisse um papel novo `NOINHERIT`:

1. `GRANT … TO PUBLIC` aplica-se a **todo** papel, inclusive `NOINHERIT` e
   sem membership. Papel dedicado **não** isola o que está em PUBLIC.
2. `GRANT … TO authenticated` **não** cai em papel que não é membro, e
   `NOINHERIT` impede herdar membership. DEFINER volátil do allowlist está
   em `authenticated` (varredura `hardening-definer-varredura`); `anon` está
   zerado — o `REVOKE FROM PUBLIC` dessas funções **já** foi feito (issue
   #128). Um papel terceiro **sem** GRANT próprio **não** herdaria esses
   EXECUTE — **se** o Auth permitisse o claim. Não permite.
3. `ALTER DEFAULT PRIVILEGES … GRANT ALL ON FUNCTIONS/TABLES TO anon,
   authenticated` (baseline, dump). Função/tabela **nova** nasce concedida a
   `authenticated` (cookie + OAuth atual), não a um papel inventado, e **não**
   a PUBLIC por essas linhas. Drift futuro: tabela nova com RLS precisa da
   restritiva `oauth_cookie_only` (já há invariante); função nova DEFINER
   precisa do par revoke — **global**, já é doutrina, não é desta integração.
4. Isolar RPC **no papel `authenticated`** exige `REVOKE EXECUTE FROM
   authenticated` nas DEFINER voláteis **ou** reescrever o corpo de cada uma
   com `client_id`. As duas mexem na Inbox (cookie chama essas funções com o
   client de sessão). Isso **não** é patch da delegação.

Prova sintética (Postgres efêmero, papel e função **descartáveis**, sem
baseline): `tests/invariants/delegacao-papel-publico-nao-isola.test.ts`.

---

## “Não mandar o JWT ao PostgREST”

**Não é solução.** O Bearer legitimamente emitido chama `/rest/v1` e `/rpc`
se a Data API estiver publicada. 404 da rota Next **não** corta isso. A
própria superfície delegada, quando ligada, **usa** anon+Bearer no
PostgREST para o SELECT. Bloquear Data API no JWT OAuth ou bloqueia a
leitura corporativa pretendida, ou deixa `/rpc` no mesmo token.

`pgrst.db_pre_request` que recusasse path `/rpc` quando `client_id` existe
seria mudança **global** de PostgREST para **todo** client OAuth, não só o
Bot. Fora desta preparação. Não implementado. Não é “alternativa completa”
sem o Felipe aceitar esse blast.

---

## Helpers realmente necessários (se um dia houver papel suportado)

Só então, e só com Auth que emita o claim (hoje **não** emite):

| Precisa | Por quê |
|---|---|
| `USAGE` em `public` | o dump não dá USAGE a PUBLIC |
| `SELECT` em `conversations`, `messages`, `contacts`, `channel_sessions`, `delegacao_visibilidade_corporativa` | superfície D3/D5 |
| EXECUTE dos DEFINER **estáveis** de RLS (`fn_user_org_ids`, `fn_conversation_scope`, `fn_role_at_least`, …) | policies avaliam com o papel do JWT |
| `GRANT papel TO authenticator` | PostgREST `SET ROLE` |
| policies `TO papel` (as `TO authenticated` não o vêem) | senão SELECT zero |

**Não** precisa: EXECUTE de DEFINER volátil (`fn_mesclar_contatos`,
`fn_lgpd_anonymize_contact`, `fn_conversation_assign`, `emit_event`, …).

Isto é inventário. **Não** há migration que crie o papel.

---

## Decisão pedida ao Felipe (ativação futura, fora deste PR)

Há **três** caminhos reais. Nenhum cabe em “só ficheiros de hook inativos”
com o Auth de hoje.

| # | Caminho | Blast | Cookie | RPC |
|---|---|---|---|---|
| A | Ficar em `authenticated` + `client_id` na RLS (0773) | já no schema preparado, não aplicado | intacta | **aberta** (mesmo EXECUTE) |
| B | Esperar/exigir Auth que aceite `role` fora de `{anon,authenticated}` + papel `NOINHERIT` + GRANT mínimo + `GRANT TO authenticator` + policies `TO` esse papel | schema de papéis, membership, policies novas; **não** é config de um hook | intacta se o hook só mexe com `client_id` presente | fechada para o papel novo **exceto** o que for GRANT explícito **e** o que restar em PUBLIC |
| C | `REVOKE EXECUTE` das DEFINER voláteis em `authenticated` **ou** guarda `client_id` no corpo de cada uma | **global**, Inbox e telas que chamam essas RPC | **quebra** ou exige rewrite de cada call site | fechada |

**Pedido:** escolher A (delegação com RPC herdada, documentada), B (só se o
Auth passar a emitir o claim — hoje a doc diz que não), ou C (mudança
global, não é integração). Sem C disfarçada de hook.

Este PR **pára** de alargar RLS/RPC. Spec 21 (mídia/documentos cookie)
permanece. Delegação HTTP 404. Sem prova de isolamento RPC, a integração
**não** se homologa como sujeito confinado.
