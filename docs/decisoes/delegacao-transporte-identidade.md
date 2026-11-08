# PROPOSTA — transporte de identidade individual delegada

**Status:** proposta implementável. **Não implementar** neste PR: sem rota,
migration, credencial, tool, client OAuth, nem grant ao vivo.

**Não é:** fluxo manual no CRM, cookie de outra pessoa, filtro amplo de
token `dsk_`, nem álgebra booleana de `PedidoDelegado`.

**Alvo de recurso (D3/D5, preparar, não ativar):** buscar / ler / baixar em
**todas** as conversas corporativas da org imobiliária, com identidade
individual verificável. Exclui outras empresas, WhatsApp/sessão pessoal e
chats privados do bot. Assigned-only e turno-atual **não** são o alvo.

---

## 1. Problema de transporte

O Bot Análise é um conector **externo** (WhatsApp). O CRM autentica pessoas
com cookie + `getUser()` + RLS (`auth.uid()`). O MCP externo autentica com
Bearer `dsk_…` contra `api_tokens` e o servidor chama `createAdminClient()`
(`lib/mcp/server.ts`) — **org, não a atendente**.

`deriveActor` nunca trata `dsk_` como usuário. Copiar o cookie da sessão de
quem opera, filtrar o token de org, ou “admin no lugar de” **não** são o
transporte.

Precisa-se de um **grant por pessoa**, ligado ao chamador, que o CRM troque
por um client Postgres cuja RLS vê `auth.uid() = Marina` (ou função
equivalente que ainda lê `auth.uid()`, nunca service role cego).

---

## 2. Protocolo proposto (duas vias; uma só se o conector aguentar)

### Via A — Authorization Code + PKCE (OAuth 2.1)

Compatível **se** o Bot Análise (ou um broker na frente) conseguir abrir um
navegador/`redirect_uri` HTTPS e guardar `code_verifier`. O CRM de login já
usa PKCE com GoTrue (`lib/auth/entrada-com-google.ts`); **isto não reusa
GoTrue como AS de delegação** — é um AS próprio, audiência distinta.

1. Bot (cliente público, `client_id` da *instalação* do bot, não da pessoa)
   gera `code_verifier` / `code_challenge` (S256).
2. Abre `GET {origem}/oauth/delegacao/authorize?response_type=code&client_id=…&redirect_uri=…&code_challenge=…&code_challenge_method=S256&state=…&scope=delegacao:buscar delegacao:ler delegacao:baixar&org_id={org}`.
3. Marina autentica **no CRM com o cookie dela** (tela `/app/delegacao/autorizar`).
   Consentimento explícito: org imobiliária, efeitos buscar/ler/baixar,
   exclusões (pessoal, sessão não corporativa, chat privado do bot, outras
   orgs). **Não** pede assigned-only.
4. CRM grava `delegated_authorization_codes` (hash do code, `user_id`,
   `organization_id`, `client_id`, `code_challenge`, `redirect_uri`,
   `peer_binding` se houver, `expires_at` ≤ 60s).
5. Redirect com `code`. Bot troca em
   `POST {origem}/oauth/delegacao/token`
   (`grant_type=authorization_code`, `code`, `code_verifier`, `client_id`,
   `redirect_uri`). PKCE inválido → 400, sem token.
6. Resposta: access token **opaco** (não JWT de sessão, não cookie).

### Via B — Device Authorization (RFC 8628) — via esperada no WhatsApp

Se o bot **não** tem navegador (caso típico: só WAHA inbound), PKCE de
redirect **não é compatível**. O bot mostra um `user_code` + URL. Marina abre
a URL **já logada no CRM**, confirma. O bot faz poll em `/oauth/delegacao/token`
com `grant_type=urn:ietf:params:oauth:grant-type:device_code`.

Não assumir Via A sem a capacidade 1 da tabela §7.

Não misturar as vias no mesmo `client_id` sem `grant_types` declarados.

---

## 3. Token, claims, client de RLS, caller binding

Access token **opaco** `dgt_<jti>_<secret>`. No banco só `token_hash`
(SHA-256). Plaintext uma vez. Nunca query string.

Grant persistido (proposta de linha, **não** criada):

| campo | valor |
|---|---|
| `jti` | uuid do grant |
| `sub` | `auth.users.id` da atendente (Marina) |
| `organization_id` | org imobiliária do consentimento |
| `client_id` | instalação do Bot Análise |
| `aud` | `delegacao-analise-inquilinos` |
| `scope` | `delegacao:buscar delegacao:ler delegacao:baixar` |
| `peer_binding` | hash do interlocutor WhatsApp no momento do consentimento (E.164 normalizado ou id WAHA), ou nulo se o conector não souber passar |
| `exp` | access ≤ 15 min |
| `refresh_exp` | opcional ≤ 8 h, rotacionado; ou sem refresh (reconsentimento) |
| `revoked_at` | nulo até revogar |

**Não copiar cookie.** Depois de validar o opaco, o handler de recurso:

1. Recusa se `revoked_at` ou `exp` passou, se `aud`/`client_id` não batem,
   se `organization_id` do pedido ≠ grant, se `scope` não cobre o efeito.
2. Recusa se o conector mandou `peer` e `peer_binding` do grant ≠ peer
   atual — João no mesmo bot não usa o grant da Marina.
3. Se o conector **não** envia peer, o grant só é emitível com
   `peer_binding` nulo **depois** de decisão explícita (hoje: recusar
   emissão — fail closed). Não inventar binding.
4. Mint de JWT **curto** para PostgREST com `sub = grant.sub`,
   `role = authenticated`, `aal` o da sessão que consentiu se MFA for
   exigido na org. Assinado com o JWT secret do GoTrue **ou**
   `auth.admin.generateLink` **não**. Preferência: API de sessão admin do
   Supabase que cria sessão para `user_id` já existente, TTL curto, sem
   senha. Sem service role nas queries de conversa/mídia.
5. `createClient` com esse JWT. RLS `conversations_select` /
   `fn_conversation_scope` vê `auth.uid() = Marina`. Filtros de aplicação
   **por cima**: `avaliarContatoPessoalDaConversa`, classificação
   corporativa da sessão, exclusão de chat privado do bot.
6. Assinar URL / fetch de provedor **só** depois desses filtros.

Revogação: `POST /oauth/delegacao/revoke` (token ou grant) e tela na
conta da pessoa. Job apaga expirados. Rotação: access novo invalida o
anterior do mesmo grant (`jti` novo).

---

## 4. Superfície de recurso (proposta; não existe)

Não usar as rotas cookie atuais com `auth-dual`. Não usar `/api/mcp` com
`dsk_`. Superfície nova, Bearer do grant, fail closed:

| método | path | efeito | notas |
|---|---|---|---|
| GET | `/api/v1/delegacao/conversas` | buscar | query: texto/data opcionais; **sem** `organization_id` no body; org sai do grant. Resposta: ids + metadado mínimo, sem preview de pessoal. |
| GET | `/api/v1/delegacao/conversas/:id` | ler | 404 mudo se pessoal / sessão não corporativa / outra org / chat do bot / sem linha RLS |
| GET | `/api/v1/delegacao/conversas/:id/anexos/:messageId` | baixar | mesmo 404; anexo tem de pertencer à conversa; assina só depois |

`lib/auth/public-paths.ts`: só os `/oauth/delegacao/*` (guard próprio:
client_id + PKCE/device). As rotas `/api/v1/delegacao/*` **não** entram na
allowlist de cookie — autenticam o grant.

Zod na borda. `requireSupportWrite` irrelevante (só leitura). `audit()` com
`reciboAuditoriaDelegada` (ids/motivo, sem corpo/URL).

---

## 5. Broker vs só-CRM

| peça | onde | pré-requisito externo? |
|---|---|---|
| AS (authorize, token, revoke, device) | CRM | não |
| Tela de consentimento cookie | CRM | não |
| Persistência grant/code/token_hash | CRM (tripla migration **depois** de aprovar) | não |
| Rotas `/api/v1/delegacao/*` + JWT de sessão | CRM | não |
| Entitlement `delegacao_visibilidade_corporativa` | CRM — **aprovação separada para gravar linha** | não |
| `client_id` da instalação do bot | CRM + operador registra | o bot precisa de um id estável |
| Abrir URL / guardar PKCE / poll device / mandar `Authorization` | Bot Análise ou broker | **sim** — ver §7 |
| Passar peer WhatsApp em toda chamada | Bot Análise ou broker | **sim** se quisermos caller binding; sem isso o grant não emite (§3.3) |
| OAuth no WAHA | WAHA | **não verificado**; não assumir |

Sem o conector cumprir §7, o CRM pode ter AS+rotas e o bot **não consegue**
usar. Isso não se resolve copiando cookie.

---

## 6. Entitlement de visibilidade (se a RLS atual não chega)

**CONFIRMADO** em `fn_conversation_scope` (migration 0726):
`org_wide_read` se papel `viewer`/`manager`/`admin` **ou**
`visibility_mode = 'all'`. Caso contrário a policy
`conversations_select` só entrega atribuídas (`assigned_to_user_id = auth.uid()`)
e, se `own_and_unassigned`, as sem dono.

Consequência para o alvo D3/D5:

- Se a atendente **já** é viewer/manager/admin (ou a org está em `all`), o
  client de sessão dela **já** vê as conversas da org. Ainda faltam os
  filtros de pessoal / sessão corporativa / chat do bot. **Não** alargar RLS.
- Se ela é `agent` e a org está em `own` / `own_and_unassigned`, a RLS
  **não** entrega todas as conversas. **Proibido** neste PR (e sem
  aprovação) alterar `fn_conversation_scope` ou `conversations_select`
  para “todo agent vê tudo”. Isso mudaria a Inbox de toda a org.

**Proposta de grant least-privilege (não aplicada):**

Tabela `delegacao_visibilidade_corporativa` (`user_id`, `organization_id`,
`scopes text[]`, `granted_by`, `granted_at`, `revoked_at`, `id`). Escrita
só por admin da org (ou dono da VPS — D4) via tela, com `audit()`. Sem
linha, o AS recusa o consentimento com `visibilidade_nao_ativada`.

Função `fn_delegacao_conversas_corporativas()` **SECURITY DEFINER**
`set search_path = public`, `revoke execute from public, anon`, grant
`authenticated`: devolve `organization_id` se existe linha viva para
`auth.uid()`. Usada **somente** nas rotas `/api/v1/delegacao/*`, **não**
na policy `conversations_select` da Inbox, até alguém aprovar à parte
que a Inbox também alargue.

Isso não é promover a pessoa a manager, não é `createAdminClient()`, não
é token de org.

`ENTITLEMENTS_VISIBILIDADE_CONCEDIDOS` no código permanece `[]` até existir
linha real **e** ativação aprovada.

---

## 7. Capacidades a validar no Bot Análise (não assumidas)

Não há implementação deste conector neste repositório. Antes de emitir
`client_id` ou ligar rotas, medir:

1. Consegue abrir (ou mandar) uma URL HTTPS para a atendente completar
   consentimento no CRM?
2. Consegue PKCE (guardar `code_verifier` entre o click e o token)? Se
   não: só Via B.
3. Consegue poll de `device_code` / troca de `authorization_code`?
4. Consegue guardar **um token por pessoa**, isolado (não um token só do
   bot)?
5. Consegue mandar `Authorization: Bearer dgt_…` para o CRM (HTTP próprio,
   não só texto no WhatsApp)?
6. Consegue mandar, em toda chamada, a identidade WhatsApp de **quem está
   falando agora** (peer), sem a atendente “escolher” o token de outra?
7. Tem `client_id` estável por instalação, ou é só inbound WAHA genérico?
8. Trata 401 (reconsentir) e 404 mudo sem vazar o corpo ao chat?

Qualquer “não” em 4–6 bloqueia ativação. 1+3 ou 1+2 são o mínimo de
transporte. Este documento **não** afirma que o bot tem OAuth.

---

## 8. Falha de segurança (sempre)

- Prova ausente, grant expirado, peer divergente, org divergente, pessoal,
  sessão não corporativa, chat do bot, entitlement ausente, JWT mint
  falhou → **404/401 mudo**, sem path, preview, URL assinada, bytes.
- Erro de DB → recusa (não “então não é pessoal”).
- Sem fallback para `dsk_`, service role, cookie de outra conta.
- Rate limit nos `/oauth/delegacao/token` e device poll (a definir na
  implementação; hoje não está).

---

## 9. Ativação (separada deste PR)

1. D1 fechado com Via A ou B medida no conector (§7).
2. D2: fonte de sessão corporativa no schema (tripla), sem allowlist
   inventada neste PR.
3. D4: quem grava `delegacao_visibilidade_corporativa`.
4. Entitlement da atendente **aprovado e auditado** (linha na tabela), sem
   alterar `conversations_select` salvo decisão extra sobre a Inbox.
5. Registrar `client_id` da instalação. Sem credencial emitida por agente.
6. Tools MCP **não** são o veículo; se um dia existirem, só depois do
   grant user-bound. `dsk_` continua recusado para esta leitura.
7. Operador aplica `update.sh`. Merge deste PR **não** ativa.

Upload manual ou navegar a Inbox com cookie **não** é a entrega. A entrega
é comando simples no bot → buscar/ler/baixar corporativo autorizado.
