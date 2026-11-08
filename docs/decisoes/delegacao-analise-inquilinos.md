# Delegação restrita para análise de inquilinos — contrato proposto (NÃO ativado)

**Status:** revisão. Sem merge, tag, release, deploy, migration, credencial ou
alteração de papéis. **CONFIRMADO** abaixo é o que o código desta branch mede.
**INFERIDO** / **EM ABERTO** não é produto.

**Autorização de preparar a correção:** Felipe, na sessão que pediu este PR de
revisão. Quem atualiza produção é o operador, não este PR.

Org de referência da imobiliária (contexto da revisão, **não** hardcoded no
código): fora deste arquivo de propósito. Não há papel "Marina" nem allowlist
de sessão corporativa no produto — não foram inventados.

---

## Duas peças, propositalmente distintas

| Peça | O que faz nesta branch | O que NÃO faz |
|---|---|---|
| **Exclusão pessoal (spec 21) nas rotas já autenticadas por cookie** | `GET /api/v1/messages/[id]/media` e `GET /api/v1/conversations/[id]/locacao/documentos` recusam `contacts.is_personal === true` com 404 mudo, **antes** de `createSignedUrl` ou fetch do adapter. A Inbox comum segue: cookie + org ativa + RLS. Sessão de canal **não** precisa ser "corporativa". | Não classifica WhatsApp pessoal vs. empresarial. Não aperta viewer/manager org-wide. Não desliga fluxos ordinários. |
| **Integração delegada buscar/ler/baixar** | Guarda puro fail-closed em `lib/auth/delegacao-empresarial.ts`. Sem rota nova, sem tool no catálogo MCP, sem `auth-dual`, sem path público. Ativação padrão: desligada. | Não emite `dsk_`. Não usa cookie de outra pessoa. Não assume sessão corporativa. Não escreve nem envia. |

A operação comum **não** passa pelo guarda delegado. Ligar a exclusão pessoal
nas rotas de cookie **não** ativa o bot compartilhado.

---

## O que foi medido no código (CONFIRMADO)

Hipóteses da revisão estática, refeitas nesta árvore (`origin/main` no momento
do branch):

1. `GET /api/v1/conversations/[id]/messages` autentica cookie (`getUser`), org
   ativa, e recusa `contacts.is_personal` no `listMessagesHandler` (404).
2. `GET /api/v1/messages/[id]/media` autenticava cookie + org e lia a mensagem
   com client de sessão (RLS + `organization_id`). **Não** lia `is_personal`.
   Persistida → `createSignedUrl` 3600s no bucket `whatsapp-media`; senão fetch
   pelo adapter. **Corrigido nesta branch:** recusa pessoal / sem
   `conversation_id` antes de assinar ou ir ao provedor.
3. `GET .../locacao/documentos` pedia `requireRole("agent", { resource: "locacao" })`,
   conversa via RLS, prefixo de storage da org, assina 300s. **Não** lia
   `is_personal`. **Corrigido nesta branch.**
4. RLS `conversations_select` (migration 0726 / `fn_conversation_scope`):
   viewer/manager/admin (e `visibility_mode = 'all'`) vêem a org inteira;
   agente vê a própria + fila conforme o modo. `organization_id` +
   `channel_session_id` **não** são autorização por usuário de sessão
   corporativa.
5. MCP `/api/mcp` Bearer `dsk_` → `lib/mcp/auth.ts`; `createMcpServer` usa
   `createAdminClient()` (bypassa RLS). `crm_get_conversation_history` exige
   `agent` + `mcp:read`. `ctx.contatoDoTurno` estreita; **ausente** (MCP
   externo) a leitura é a da organização do token, não a RLS individual de
   uma atendente. Token de org **não** reproduz a identidade da pessoa.
6. As rotas de mídia/documentos desta correção **continuam cookie-only**.
   Não receberam `auth-dual` nem entrada em `lib/auth/public-paths.ts`.

**Não medido:** imagem de runtime em produção, policies efetivas no Postgres
da VPS, equivalência build ↔ `f52855339`. Este PR não fala com servidor vivo.

---

## Contrato proposto da delegação (EM ABERTO — não implementar sem aprovação)

Para o bot compartilhado pedir triagem **só** de conversas/documentos do
negócio imobiliário, com as permissões efetivas de quem delegou:

1. **Identidade** = usuário autenticado (`ator.type === "user"` + id). Token
   `dsk_` de organização, service role, cookie de outra conta e "admin no
   lugar de" recusam (`identidade_nao_provada`).
2. **Organização** do ator = organização do recurso.
3. **Conversa** autorizada para **esse** usuário (RLS do client de sessão,
   não admin). Viewer org-wide continua sendo decisão de visibilidade da
   org — a delegação não alarga isso.
4. **Contato** com `is_personal === true` recusa.
5. **Sessão de canal** com classificação **provada** `corporativa`. Pessoal
   recusa. `nao_classificada` recusa. Hoje **não existe** fonte no schema
   (sem allowlist, sem coluna, sem papel). O provedor embarcado devolve
   `nao_classificada`. Não se assume que toda sessão é da empresa.
6. **Anexo** só depois da associação conversa (e processo, se houver).
7. Só `buscar` | `ler` | `baixar`. Sem write/send e sem fallback amplo.
8. Auditoria: ids + motivo, **sem** corpo, preview, telefone, path, URL.
9. Desconhecido recusa.

Ativação (`ativa` ∧ `contratoAprovado`) é argumento do guarda. Produção
passa `ATIVACAO_DELEGADA_PADRAO` (ambos falsos). **Não há variável de
ambiente que ligue isto.**

Ferramentas candidatas (nomes, não contrato de wire — **fora** de
`allTools` / `TOOL_CATALOG`):

- `crm_search_corporate_conversations`
- `crm_read_corporate_conversation`
- `crm_download_corporate_attachment`

---

## Decisões de produto ainda sem dono

Não foram inventadas. Precisam de aprovação **antes** de qualquer schema,
token ou registro no catálogo:

| # | Pergunta | Risco se inventarmos agora |
|---|---|---|
| D1 | Como a identidade da atendente chega ao bot compartilhado (sessão dela, token **ligado a user**, outro)? | Org token + admin = leitura org-wide. |
| D2 | Onde mora a classificação corporativa da sessão de canal? | Sem fonte, "todas corporativas" vaza WhatsApp pessoal. |
| D3 | A visibilidade org-wide de viewer/manager vale para o bot ou só conversa atribuída? | Alargar é mudança de política, não bugfix. |
| D4 | Quem aprova a ativação na org (admin da org? dono da VPS?) | Ligar no código sem superfície é config invisível. |
| D5 | O bot pode buscar em várias conversas da empresa ou só a do turno? | Busca ampla × `contatoDoTurno`. |

**Proposta de schema (não aplicada):** tabela ou settings versionados com
allowlist de `channel_session_id` corporativos **por organização**, escrita
só por admin, lida pelo guarda. Migration + baseline + `-- manifest:` só
depois desta aprovação. Não entra neste PR.

---

## Checklist de ativação (aprovação à parte)

- [ ] D1–D5 respondidos por escrito.
- [ ] Identidade individual provada; org token sozinho continua recusado.
- [ ] Fonte de classificação corporativa no banco (tripla de migration).
- [ ] Sem credencial nova emitida por agente; o operador cria se quiser.
- [ ] Tools no catálogo MCP só depois do guarda verde nos casos sintéticos.
- [ ] Sem `auth-dual` nas rotas de mídia/documentos só para "facilitar o bot".
- [ ] Auditoria sem conteúdo. Sem dado real de cliente nos testes.
- [ ] Quem atualiza a VPS é o operador (`update.sh`), não o merge deste PR.

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
