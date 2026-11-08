# Matriz OAuth Data API / RPC — JWT `authenticated` + `client_id`

**Status:** preparação para revisão. **Não ativado.** Sem token emitido.
Fonte de código: `lib/auth/delegacao-oauth-matriz.ts`. Schema: migration 0773
(não aplicada a banco de cliente).

Fail-closed: o que não está na allowlist de leitura **recusa** para JWT com
`client_id`. Cookie (`client_id` IS NULL) passa nas restritivas e segue a
Inbox.

Rotas HTTP 404 **não** protegem um JWT legitimamente emitido usado contra
PostgREST `/rest/v1` ou `/rpc`. Esta matriz é a camada de banco.

## Allow (SELECT OAuth com grant vivo)

| Objeto | Condição além do grant | Escrita OAuth |
|---|---|---|
| `delegacao_visibilidade_corporativa` | `user_id = auth.uid()` | sem GRANT |
| `conversations` | sessão `corporativa` + `contacts.is_personal is false` | cookie only |
| `messages` | a conversa da linha passa o mesmo recorte | cookie only |
| `contacts` | `is_personal is false` | cookie only |
| `channel_sessions` | `classificacao_empresarial = 'corporativa'` | cookie only |

`contacts` e `channel_sessions` **não** podem ser cookie-only: a policy extra
de `conversations` faz `EXISTS` nelas, e o EXISTS herda o RLS do JWT. Sem
SELECT operacional/corporativa, a extra recusaria até conversa corporativa.

## Deny (default)

Toda tabela `public` com RLS fora da lista, via policy restritiva
`oauth_cookie_only` (`FOR ALL TO authenticated`, `client_id IS NULL`).
Inclui `locacao_*` (documentos do processo), irmã `notes`/mídia interna no
banco, leads, etc. `storage.objects` tem a mesma restritiva (buckets
`whatsapp-media`, `locacao-processos`, demais).

Tabela **nova** com RLS e sem essa restritiva: o invariante
`tests/invariants/delegacao-oauth-deriva-rls.test.ts` reprova.

## Novo vs herdado

| Classe | O quê |
|---|---|
| **Novo** (0773 introduz para `client_id`) | SELECT de conversa/mensagem corporativa operacional com grant — agent own cookie **não** via essa linha atribuída a outro; OAuth+grant **sim** (D3/D5). SELECT operacional de `contacts` / sessão `corporativa`. |
| **Herdado agora negado** | SELECT org-wide de contato pessoal, sessão pessoal/NULL, `locacao_*`, Storage, resto das tabelas RLS. Era capacidade do papel `authenticated`; o JWT OAuth herdava. |
| **Herdado ainda aberto** | `EXECUTE` de SECURITY DEFINER volátil permitida a `authenticated` (`fn_mesclar_contatos`, `fn_lgpd_anonymize_contact`, `fn_conversation_assign`, `emit_event`, …). Nenhuma lê `client_id`. 0773 **não** concede EXECUTE novo. |

## RPC — bloqueio que pede decisão (fora deste PR)

Confinar RPC **e** preservar cookie no mesmo JWT `role=authenticated` não é
seguro: revogar EXECUTE quebra a Inbox; guardar cada DEFINER é refactor
amplo; patchar três paths e declarar confinamento global seria mentira.

O enum `anon`|`authenticated` na **página de docs** do hook **não** é o
schema de runtime. GoTrue v2.196.0 valida `role` como `type: string`
(`MinimumViableTokenSchema`). Emissão com papel terceiro: **MEDIDO** em
Auth descartável (M1 12/12 — `role=oauth_delegado` só no client mapeado).
`GRANT TO PUBLIC` alcança qualquer papel `NOINHERIT` (**MEDIDO** M2).
“Não mandar o JWT ao PostgREST” **não** corta `/rest/v1`/`/rpc`. Lei:
[`delegacao-papel-dedicado.md`](delegacao-papel-dedicado.md). Evidência:
[`../evidencias/delegacao-m1-m2-vm-2026-11-08.md`](../evidencias/delegacao-m1-m2-vm-2026-11-08.md).

A homologação **não** trata o JWT OAuth do **produto** como sujeito
confinado na RPC: hook/CREATE ROLE **não** estão no CRM. M1/M2 não ligam
o produto.

## Spec 21 (cookie) vs esta matriz

A exclusão `is_personal === false` nas rotas cookie de mídia/documentos é
independente. Irmã `notes/[noteId]/media` **não** foi expandida. Default-deny
OAuth em tabelas de notes/Storage **fecha** o JWT OAuth; **não** altera o
cookie.

## Views

Views `security_invoker=true` herdam as restritivas das bases. View sem
invoker concedida a `authenticated` é derivada no invariante (lista deve
permanecer vazia).
