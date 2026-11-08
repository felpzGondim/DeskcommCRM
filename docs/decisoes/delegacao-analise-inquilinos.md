# Delegação restrita para análise de inquilinos — contrato proposto (NÃO ativado)

**Status:** revisão / preparação. Sem merge, tag, release, deploy, migration,
credencial ou alteração de papéis. **CONFIRMADO** abaixo é o que o código
desta branch mede. **INFERIDO** / **EM ABERTO** não é produto ao vivo.

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
| **Integração delegada buscar/ler/baixar** | Guarda puro fail-closed em `lib/auth/delegacao-empresarial.ts`. Sem rota nova, sem tool no catálogo MCP, sem `auth-dual`, sem path público. Ativação padrão: desligada. Entitlement de visibilidade corporativa: **nenhum concedido**. | Não emite `dsk_`. Não usa cookie de outra pessoa. Não assume sessão corporativa. Não escreve nem envia. Não altera RLS da Inbox. |

A operação comum **não** passa pelo guarda delegado. Ligar a exclusão pessoal
nas rotas de cookie **não** ativa o bot compartilhado.

Transporte de identidade (proposta, não código):
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

1. **Identidade** = usuário autenticado (`ator.type === "user"` + id), via
   transporte em [`delegacao-transporte-identidade.md`](delegacao-transporte-identidade.md).
   Token `dsk_` de organização, service role, cookie de outra conta e
   "admin no lugar de" recusam (`identidade_nao_provada`).
2. **Organização** do ator = organização do recurso. Outras empresas recusam.
3. **Visibilidade (D3/D5 — alvo decidido):** buscar / ler / baixar em
   **todas** as conversas corporativas da org imobiliária. **Não** é
   assigned-only. **Não** é só a conversa do turno. Implementação e
   entitlement auditável **faltam**; o guarda recusa
   `visibilidade_nao_ativada` enquanto
   `ENTITLEMENTS_VISIBILIDADE_CONCEDIDOS` estiver vazio. Não alargar
   `conversations_select` neste PR. Se a RLS da pessoa já for org-wide
   (viewer/manager/admin ou `visibility_mode=all`), o client de sessão
   basta como teto; os filtros 4–6 continuam. Se for `agent` em `own` /
   `own_and_unassigned`, a proposta é tabela
   `delegacao_visibilidade_corporativa` usada **só** na superfície
   delegada — ver transporte §6.
4. **Contato** só segue com prova `is_personal === false`. Pessoal, erro,
   ausência e malformado recusam.
5. **Sessão de canal** com classificação **provada** `corporativa`. Pessoal
   recusa. `nao_classificada` recusa. WhatsApp pessoal do Felipe está
   neste recorte. Hoje **não existe** fonte no schema (sem allowlist de
   session id, sem coluna, sem papel). O provedor embarcado devolve
   `nao_classificada`. Não se assume que toda sessão é da empresa.
6. **Chat privado do bot** recusa (`true` ou `nao_provado`). Fonte ainda
   não existe.
7. **Anexo** só depois da associação conversa (e processo, se houver).
8. Só `buscar` | `ler` | `baixar`. Sem write/send e sem fallback amplo.
9. Auditoria: ids + motivo, **sem** corpo, preview, telefone, path, URL.
10. Desconhecido / erro de DB recusa.

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
| D1 | **EM ABERTO** (proposta técnica) | Transporte: AS próprio, auth-code+PKCE se o conector tiver browser; senão device_code. Client de RLS com `sub` da atendente. Sem copiar cookie, sem `dsk_`. Ver [`delegacao-transporte-identidade.md`](delegacao-transporte-identidade.md). Capacidades do Bot Análise **não** medidas. |
| D2 | **EM ABERTO** (proposta) | Fonte da classificação corporativa da sessão. Sem allowlist de ids neste PR. Unknown deny. |
| D3 | **ALVO DECIDIDO — não ativado** | Todas as conversas corporativas da org imobiliária (não assigned-only). Entitlement explícito, auditável, aprovação separada para conceder. RLS existente não é bypassada com admin/org token. |
| D4 | **EM ABERTO** | Quem grava o entitlement e quem liga a integração na org (admin da org? dono da VPS?). |
| D5 | **ALVO DECIDIDO — não ativado** | Buscar / ler / baixar nesse conjunto (não só o turno). Tools candidatas acima, fora do catálogo. |

**Proposta de schema (não aplicada):** (a) classificação corporativa de
`channel_session_id` **por organização**, escrita só por admin; (b)
`delegacao_visibilidade_corporativa` por `user_id`+org, usada só na
superfície delegada até decisão extra sobre a Inbox. Migration + baseline
+ `-- manifest:` só depois de D1/D2/D4 e da aprovação do grant. Não entra
neste PR.

Boolean de `PedidoDelegado` **não** é integração de auth completa: o
caminho `ok: true` do guarda permanece inalcançável enquanto o entitlement
concedido for lista vazia.

---

## Checklist de ativação (aprovação à parte)

- [ ] D1 medido no conector (§7 do transporte) e Via A ou B escolhida.
- [ ] D2 com fonte no banco (tripla de migration).
- [ ] Entitlement da atendente gravado de forma auditável (D3/D5); sem
      linha = recusa. Sem alterar `conversations_select` salvo decisão extra.
- [ ] D4 respondido (quem grava / quem liga).
- [ ] Identidade individual provada; org token sozinho continua recusado.
- [ ] Sem credencial nova emitida por agente; o operador cria `client_id`.
- [ ] Superfície `/api/v1/delegacao/*` (ou equivalente) com JWT de sessão;
      MCP `dsk_` + admin **não** é o veículo.
- [ ] Sem `auth-dual` nas rotas cookie de mídia/documentos só para "facilitar o bot".
- [ ] Auditoria sem conteúdo. Sem dado real de cliente nos testes.
- [ ] Irmã `notes/.../media` revista à parte se o produto quiser o mesmo 404.
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
