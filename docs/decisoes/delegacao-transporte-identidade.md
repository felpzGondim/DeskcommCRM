# Transporte de identidade delegada — GoTrue OAuth 2.1 Server

**Status:** preparação para revisão. **Não ativado.** Sem emissão de token, sem
client OAuth registrado, sem grant ao vivo, sem callback medido.

**Não é:** AS inventado neste app, `device_code`, cookie de outra pessoa,
token `dsk_`, JWT assinado aqui, `user_metadata` como autorização, header de
chat, nem peer-binding WhatsApp.

WhatsApp é a **fonte dos documentos de negócio**. Não é o canal em que a
atendente fala com o Bot. O sujeito OAuth identifica a **usuária do CRM**.

---

## 0. Capacidade do produto vs enablement desta instalação

| Camada | Estado | Citação |
|---|---|---|
| **Capacidade (Auth binário)** | OAuth 2.1 Server existe no GoTrue desde v2.180.0 (2025-09-23). Este kit pina `supabase/gotrue:v2.196.0`. | [OAuth 2.1 Server](https://supabase.com/docs/guides/auth/oauth-server); `tests/shell/supabase-imagens-plataforma.test.sh` |
| **Enablement deste projeto** | **Não confirmado.** `GOTRUE_OAUTH_SERVER_ENABLED` e `GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION` são flags do **Auth**, não variáveis de `lib/env.ts`. Este PR **não** as liga e **não** as acrescenta ao `.env.example`. | [OAuth 2.1 Server](https://supabase.com/docs/guides/auth/oauth-server) |
| **Fluxos suportados pelo Auth** | Só `authorization_code` + PKCE e `refresh_token`. **Não** há `device_code` documentado. | [OAuth flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows) |
| **Token** | Access token OAuth **é** JWT padrão do Auth (`sub`, `role`, `aud` tipicamente `"authenticated"`, `client_id` nos tokens OAuth; sessão cookie tem `client_id` nulo). RLS com `auth.uid()` aplica. | [Token security](https://supabase.com/docs/guides/auth/oauth-server/token-security) |
| **Verificação** | JWT de usuário exige `iss`, `aud`, `exp`, `iat`, `sub`, `role`, `session_id` ([JWT Claims Reference](https://supabase.com/docs/guides/auth/jwt-fields)). Token OAuth acrescenta `client_id` ([token security](https://supabase.com/docs/guides/auth/oauth-server/token-security)). `getClaims` verifica assinatura e `exp`; JWT não expirado continua válido após sign-out. `getUser(jwt)` é pedido de rede ao Auth — a [guia SSR avançada](https://supabase.com/docs/guides/auth/server-side/advanced-guide) o documenta para detectar sessão encerrada no servidor. [signOut](https://supabase.com/docs/reference/javascript/auth-signout): o access token JWT não se revoga até `exp`. Teste offline não prova o Auth. | [JWTs](https://supabase.com/docs/guides/auth/jwts); [sessões](https://supabase.com/docs/guides/auth/sessions) |
| **Escopos OIDC** | `openid` / `email` / `profile` / `phone` **não** controlam acesso ao banco. Efeitos `buscar\|ler\|baixar` vivem no grant. | [Token security](https://supabase.com/docs/guides/auth/oauth-server/token-security) |
| **Terceiros como IdP** | Third-party Auth (Clerk etc.) é a **direção oposta** (confiar JWT estrangeiro). Não é o caminho: o sujeito tem de ser usuário do CRM. | [Third-party overview](https://supabase.com/docs/guides/auth/third-party/overview) |
| **Cursor MCP** | HTTPS remoto, authorization-code + PKCE, RFC 9728, RFC 8707, refresh; DCR **ou** `CLIENT_ID` estático (`CLIENT_SECRET`/scopes opcionais). Contas **individuais** por colega; login compartilhado **não** entra. | [Cursor MCP](https://cursor.com/docs/mcp); [shared bots](https://cursor.com/help/grok-bot/shared-bots) |
| **Interop Grok Bot ↔ callback GoTrue** | **Não medido.** Callbacks Cursor documentados (`https://www.cursor.com/agents/mcp/oauth/callback`, `http://localhost:8787/callback`) ainda precisam ser testados contra o allowlist do Auth. Não bloqueia as peças offline. | Cursor docs (geral) |

`device_code` **não** é caminho. Custom Access Token Hook (para pôr `aud` =
resource RFC 8707 no JWT) é config viva do Auth — **não ligada**.

---

## 1. Ponte sujeito → RLS (o que o código faz)

1. O conector apresenta `Authorization: Bearer` com JWT **emitido pelo Auth**.
2. `verificarSujeitoOAuth` (`lib/auth/delegacao-oauth-sujeito.ts`):
   recusa `dsk_`, Bearer ausente, `getUser` com erro/usuário nulo, `sub`
   ≠ `user.id`, `role` ≠ `"authenticated"` (ausente inclusive), `aud` ≠
   `"authenticated"` (não é URL de recurso), `iss` ≠ origem do Auth +
   `/auth/v1`, `client_id` vazio (sessão cookie), `session_id` ausente ou
   não-UUID, `exp` ausente/não-finito/passado, `iat` ausente. **Não** lê
   metadado de perfil. **Não** assina.
3. Client PostgREST com **anon key** + o mesmo Bearer
   (`lib/supabase/jwt-usuario.ts`). RLS vê `auth.uid()` da atendente.
   **Nunca** `createAdminClient`.
4. Grant vivo em `delegacao_visibilidade_corporativa` (`user_id` = `sub`,
   `oauth_client_id` = `client_id`, `revoked_at` nulo, `expires_at` futuro,
   efeito pedido ∈ `efeitos`). Lookup que falha **recusa** (`grant_ausente`);
   sem fallback de dono/admin. Distinto de JWT `exp` e de sessão Auth.
5. Policy extra `conversations_select_delegacao_oauth` (migration 0773):
   só token com `client_id` + grant vivo + sessão `corporativa` +
   `contacts.is_personal is false`. A policy de cookie
   (`conversations_select`) exige `client_id IS NULL` — a Inbox não muda.
   Escritas de `conversations`/`messages` também exigem `client_id IS NULL`.
   Restritivas AND: `messages_select_delegacao_oauth`,
   `conversations_select_delegacao_restritiva`, SELECT grant-aware em
   `contacts` / `channel_sessions` (EXISTS da extra precisa enxergar a
   linha operacional; pessoal/NULL recusa). Default-deny
   `oauth_cookie_only` nas demais tabelas `public` com RLS e em
   `storage.objects` — inclui `locacao_*`. Matriz:
   [`delegacao-oauth-matriz.md`](delegacao-oauth-matriz.md).
6. Camada de app ainda recusa classificação NULL/pessoal e contato pessoal
   (`executarSuperficieDelegada`). Manager/admin com OAuth não vê pessoal
   pela policy extra; a Inbox por cookie continua vendo o que já via.
   **RPC:** o JWT OAuth é o mesmo papel `authenticated` da cookie.
   `EXECUTE` de SECURITY DEFINER volátil herdado **não** lê `client_id`.
   404 de rota não impede `/rpc`. Confinar RPC pede decisão (hook de role
   ou não apresentar o JWT ao PostgREST) — não está neste PR.

**Não implementado (proposital):** authorize, token, DCR, registro de
client, INSERT de grant, escrita de `classificacao_empresarial`, servir
RFC 9728, ligar `GOTRUE_OAUTH_SERVER_ENABLED`.

---

## 2. O que foi descartado (e por quê)

| Caminho | Por que não |
|---|---|
| AS próprio neste app + JWT opaco `dgt_` | O Auth já é o AS suportado. Inventar AS duplica consentimento e verificação. |
| `device_code` | Não está nos fluxos do Auth; não foi verificado no Bot. |
| Third-party Auth | Sujeito deixaria de ser o usuário do CRM. |
| Mintar JWT só para setar `auth.uid()` | Proibido: não é verificação suportada. |
| `dsk_` + admin client | Org, não pessoa. `/api/mcp` permanece isolado. |
| Header de chat / peer WhatsApp | O sujeito é a usuária OAuth, não o par da mensagem. |
| Login compartilhado do Bot | Cursor documenta conta individual por colega. |
| Boolean `conversaAutorizadaParaOUsuario` / `chatPrivadoDoBot` | Prova do chamador. A superfície OAuth não os aceita. |

---

## 3. Superfície HTTP (desligada)

| Path | Agora | Depois da ativação (não neste PR) |
|---|---|---|
| `/api/mcp/delegacao` | 404 antes de efeitos | MCP/REST com o Bearer OAuth; **não** `dsk_` |
| `/.well-known/oauth-protected-resource/api/mcp/delegacao` | 404 | RFC 9728 (`resource` + `authorization_servers` = origem do Auth) |

`PUBLIC_PATHS` já cobre `/api/mcp/*`. O well-known ganhou âncora própria. O
guarda é da rota.

---

## 4. Limitações externas (não fingir integração)

1. Enablement do OAuth Server nesta VPS **não confirmado**.
2. Interop callback Grok Bot × GoTrue **não medido**.
3. `aud` no JWT continua `"authenticated"` sem o Hook. A superfície exige
   `aud` autenticado + `client_id` + grant; **não** afirma audiência de
   recurso RFC 8707. O documento RFC 9728 (quando servido) declara `resource`
   à parte — isso não entra no JWT.
4. Fronteira RLS **não** tapada neste PR: `contacts` e `channel_sessions`
   continuam SELECT org-wide para membro; `locacao_processo_documentos`
   idem. A superfície delegada **não** usa essas listagens como autorização.
   `GET .../notes/[noteId]/media` permanece irmã não patchada.
5. `whatsapp-media` não tem policy de SELECT para `authenticated`; download
   vai por URL assinada na app, depois da superfície + spec 21.
6. Sem client OAuth e sem linha de grant, `ok: true` HTTP é inalcançável
   (rota 404 + ativação padrão falsa).

---

## 5. Checklist mínimo de ativação futura (Felipe / operador)

Não é trabalho deste PR. Sem ordem de “quem” além: Felipe aprova o grant.

1. Confirmar `GOTRUE_OAUTH_SERVER_ENABLED` no Auth desta instalação.
2. Registrar client (DCR **ou** `CLIENT_ID` estático). Redirect URIs do
   Cursor **só depois** do teste de interop.
3. Classificar sessões de canal (`corporativa` / `pessoal`); NULL continua
   recusa. Sem inventar ids.
4. Inserir grant (`user_id` da atendente, org imobiliária, `oauth_client_id`,
   efeitos `buscar,ler,baixar`, `expires_at`). Sem linha = recusa.
5. Ligar `ATIVACAO_DELEGADA_PADRAO` **e** passar a servir a superfície /
   RFC 9728 — dois portões, nenhum env var do app faz isso hoje.
6. Medir callback Grok Bot. Sem isso, não anunciar o conector como pronto.
