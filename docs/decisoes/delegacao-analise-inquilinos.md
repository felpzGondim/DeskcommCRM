# Delegação restrita para análise de inquilinos — contrato proposto (NÃO ativado)

**Status:** revisão / preparação. Sem merge, tag, release, deploy, banco vivo,
credencial ou papéis. Migration **preparada e não aplicada** a nenhum banco
de cliente. **CONFIRMADO** abaixo é o que o código desta branch mede.
**INFERIDO** / **EM ABERTO** não é produto ao vivo. Enablement do OAuth
Server **nesta** instalação não está confirmado.

**Autorização de preparar:** Felipe. Quem atualiza produção é o operador,
não este PR. Preparar **não** concede visibilidade ao vivo.

Org de referência da imobiliária (contexto da revisão, **não** hardcoded no
código): fora deste arquivo de propósito. Não há papel "Marina" nem allowlist
de `channel_session_id` no produto.

---

## Duas peças, propositalmente distintas

| Peça | O que faz nesta branch | O que NÃO faz |
|---|---|---|
| **Exclusão pessoal (spec 21) nas rotas já autenticadas por cookie** | `GET /api/v1/messages/[id]/media` e `GET|PATCH /api/v1/conversations/[id]/locacao/documentos` recusam a menos que a conversa da org aponte a um contato da mesma org com `is_personal === false` (booleano literal), **antes** de `createSignedUrl` ou fetch do adapter. Erro de consulta, conversa/contato ausente, `contact_id` vazio ou `is_personal` malformado → 404 mudo (fail closed). A Inbox comum segue: cookie + org ativa + RLS. Sessão de canal **não** precisa ser "corporativa". | Não classifica WhatsApp pessoal vs. empresarial. Não aperta viewer/manager org-wide. Não desliga fluxos ordinários (`is_personal === false` continua). |
| **Integração delegada buscar/ler/baixar** | Verificador `getUser(jwt)` + claims obrigatórias do JWT de usuário; client anon; superfície `executarSuperficieDelegada`; rotas **404**; schema 0773 (grant + classificação + extra OAuth + default-deny `oauth_cookie_only` + SELECT grant-aware em contacts/channel_sessions) **só arquivo**. RPC do papel `authenticated` **não** confinada — ver [`delegacao-oauth-matriz.md`](delegacao-oauth-matriz.md) e evidência GoTrue em [`delegacao-papel-dedicado.md`](delegacao-papel-dedicado.md). Tools fora do catálogo. | Não emite token. Não registra client. Não grava grant. Não classifica sessão. Não chama `/api/mcp` admin. Não liga GoTrue. Não prova revogação de sessão Auth com mock. Não declara confinamento global de RPC. Não configura Custom Access Token Hook. |

A operação comum **não** passa pela superfície delegada. Ligar a exclusão
pessoal nas rotas de cookie **não** ativa o bot.

Transporte (GoTrue OAuth 2.1 Server, não AS inventado):
[`delegacao-transporte-identidade.md`](delegacao-transporte-identidade.md).

---

## O que foi medido no código (CONFIRMADO)

Hipóteses da revisão estática, refeitas nesta árvore (`origin/main` no momento
do branch):

1. `GET /api/v1/conversations/[id]/messages` autentica cookie (`getUser`), org
   ativa, e recusa `contacts.is_personal` no `listMessagesHandler` (404).
2. `GET /api/v1/messages/[id]/media` autenticava cookie + org e lia a mensagem
   com client de sessão (RLS + `organization_id`). **Não** lia `is_personal`.
   Persistida → `createSignedUrl` 3600s no bucket `whatsapp-media`; senão fetch
   pelo adapter. **Corrigido nesta branch:** recusa pessoal / não provado /
   sem `conversation_id` antes de assinar ou ir ao provedor.
3. `GET|PATCH .../locacao/documentos` pedia `requireRole("agent", { resource: "locacao" })`,
   conversa via RLS, prefixo de storage da org, assina 300s. **Não** lia
   `is_personal`. **Corrigido nesta branch** no `contexto()` compartilhado.
4. RLS `conversations_select` (migration 0726 / `fn_conversation_scope`):
   `org_wide_read` se viewer/manager/admin **ou** `visibility_mode = 'all'`;
   senão só atribuídas (+ não atribuídas se `own_and_unassigned`).
   `organization_id` + `channel_session_id` **não** são autorização por
   sessão corporativa.
5. MCP `/api/mcp` Bearer `dsk_` → `lib/mcp/auth.ts`; `createMcpServer` usa
   `createAdminClient()` (bypassa RLS). `crm_get_conversation_history` exige
   `agent` + `mcp:read`. `ctx.contatoDoTurno` estreita; **ausente** (MCP
   externo) a leitura é a da organização do token, não a RLS individual de
   uma atendente. Token de org **não** reproduz a identidade da pessoa.
6. As rotas de mídia/documentos desta correção **continuam cookie-only**.
   Não receberam `auth-dual` nem entrada em `lib/auth/public-paths.ts`.

**Irmã não patchada (exposição documentada, fora deste PR):**
`GET /api/v1/conversations/[id]/notes/[noteId]/media` — cookie +
`requireRole("agent", conversation_notes)`, conversa da org, assina
`internal-media` 60s. **Não** chama `conversaTemContatoPessoal`. Anexo de
nota interna, bucket distinto. Não estender em silêncio.

**Não medido:** imagem de runtime em produção, policies efetivas no Postgres
da VPS, equivalência build ↔ `f52855339`. Este PR não fala com servidor vivo.

---

## Contrato proposto da delegação (NÃO ativado)

Resposta de produto **CONFIRMADA** (Felipe, 08/11/2026 13:12 São Paulo),
escopo-alvo para **preparar**. Não é grant ao vivo.

Para o bot compartilhado pedir triagem nas conversas/documentos do negócio
imobiliário, com as permissões efetivas de quem delegou:

1. **Identidade** = usuário do CRM no JWT OAuth do Auth (`getUser(jwt)` +
   `client_id` presente). Token `dsk_`, service role, cookie (sem
   `client_id`) e "admin no lugar de" recusam. WhatsApp não identifica a
   pessoa — é só a fonte dos documentos.
2. **Organização** do ator = organização do recurso. Outras empresas recusam.
3. **Visibilidade (D3/D5 — alvo decidido):** buscar / ler / baixar em
   **todas** as conversas corporativas da org imobiliária. **Não** é
   assigned-only. **Não** é só a conversa do turno. Tabela
   `delegacao_visibilidade_corporativa` (0773, **zero linhas**) + policy
   extra OAuth. `conversations_select` de cookie exige `client_id IS NULL`
   (Inbox intacta). Sem grant vivo a policy extra não abre linha.
4. **Contato** só segue com prova `is_personal === false`. Pessoal, erro,
   ausência e malformado recusam.
5. **Sessão de canal** com `classificacao_empresarial = 'corporativa'`
   (coluna 0773, default NULL = recusa). Pessoal recusa. Não se semeia
   session id. WhatsApp pessoal do Felipe cai neste recorte quando a
   coluna for escrita (ativação futura).
6. **Anexo** só depois da associação conversa (e processo, se houver).
7. Só `buscar` | `ler` | `baixar`. Sem write/send e sem fallback amplo.
8. Auditoria: ids + motivo, **sem** corpo, preview, telefone, path, URL.
9. Desconhecido / erro de DB recusa. Três revogações distintas: JWT `exp`
   (claim); sessão Auth (`getUser` de rede, não provado offline); grant
   `revoked_at` / `expires_at` (lookup fail-closed, sem fallback). Refresh
   token não entra nesta superfície.

Ativação (`ativa` ∧ `contratoAprovado`) é argumento do guarda. Produção
passa `ATIVACAO_DELEGADA_PADRAO` (ambos falsos). **Não há variável de
ambiente que ligue isto.** O entitlement de visibilidade é **outro**
portão, também falso.

Ferramentas candidatas (nomes, não contrato de wire — **fora** de
`allTools` / `TOOL_CATALOG`):

- `crm_search_corporate_conversations`
- `crm_read_corporate_conversation`
- `crm_download_corporate_attachment`

A entrega pretendida é comando simples no bot → busca/leitura/download
corporativo autorizado. Navegar a Inbox com cookie **não** é essa entrega.

---

## Decisões de produto

| # | Estado | Conteúdo |
|---|---|---|
| D1 | **CAMINHO ESCOLHIDO — não ativado** | Sujeito = JWT OAuth do GoTrue (`authorization_code`+PKCE). `getUser(jwt)` + client anon. Sem AS próprio, sem `device_code`, sem peer-binding. Enablement do Auth **nesta** instalação não confirmado. Interop callback Grok Bot **não medido**. |
| D2 | **SCHEMA PREPARADO — zero valores** | `channel_sessions.classificacao_empresarial` (`corporativa` \| `pessoal` \| NULL). NULL recusa. Sem allowlist de ids, sem seed. |
| D3 | **ALVO DECIDIDO — não ativado** | Todas as conversas corporativas da org imobiliária (não assigned-only). Grant + policy extra OAuth; Inbox cookie intacta. |
| D4 | **NÃO TRAVA A PREPARAÇÃO** | Felipe aprova grants/ativação. UI de escrita não entra neste PR (service_role no schema; authenticated não insere). |
| D5 | **ALVO DECIDIDO — não ativado** | Buscar / ler / baixar nesse conjunto. Tools candidatas fora do catálogo. Rotas 404. |

Boolean de `PedidoDelegado` **não** é a integração. A superfície OAuth não
aceita prova do chamador. HTTP 404 enquanto `ATIVACAO_DELEGADA_PADRAO`
está falsa. `ENTITLEMENTS_VISIBILIDADE_CONCEDIDOS` segue vazio.

---

## Checklist de ativação (aprovação à parte)

Checklist mínimo (detalhe no transporte §5):

- [ ] Auth desta instalação com `GOTRUE_OAUTH_SERVER_ENABLED` (não é env do app).
- [ ] Client OAuth (DCR ou `CLIENT_ID`); redirect URIs só após interop.
- [ ] Sessões de canal classificadas; NULL continua recusa.
- [ ] Grant da atendente (Felipe aprova); sem linha = recusa.
- [ ] Ligar `ATIVACAO_DELEGADA_PADRAO` **e** servir `/api/mcp/delegacao` + RFC 9728.
- [ ] Medir callback Grok Bot × GoTrue. Sem isso, não anunciar o conector.
- [ ] Identidade individual; `dsk_` + admin continuam recusados.
- [ ] Sem `auth-dual` nas rotas cookie de mídia/documentos.
- [ ] Irmã `notes/.../media` revista à parte se o produto quiser o mesmo 404.
- [ ] Quem atualiza a VPS é o operador (`update.sh`), não o merge deste PR.

**Prova RLS:** `pnpm test:db tests/invariants/delegacao-visibilidade-corporativa-rls.test.ts`
(Postgres efêmero). `test:unit` não aplica o schema e **não** é prova booleana
de policy.

---

## Destino (doutrina de extensões)

**Núcleo** para a exclusão pessoal (spec 21 já é do núcleo; o buraco era
defesa em profundidade). **Ambos / futura extensão** para a delegação: com
zero ativações a operação comum continua inteira — o guarda desligado é
recusa, não feature.

Living System Checklist (peça = guarda de mídia/documentos + contrato
delegado):

1. Quem alimenta → rotas cookie já existentes; futuro chamador só com provas.
2. Quem alimenta → a mesma Inbox; o bot **não** é consumidor até ativar.
3. Registro → 404 mudo no pessoal; recibo delegado só ids/motivo.
4. Tela → conversa pessoal já 404 na Inbox; mídia/docs acompanham.
5. Porta → nenhuma tela nova; sem registro em navegação.
6. Anti-morte → leitura pura; justificativa: não cria demanda.
7. Configuração → delegação desligada sem knob; ligar pede este checklist.
8. Continuidade IA↔humano → intocada.
9. Laço → testes que ficam vermelhos se a exclusão sair do fonte.
10. Mapa → `docs/architecture/delegacao-analise-inquilinos.architecture.json`.
