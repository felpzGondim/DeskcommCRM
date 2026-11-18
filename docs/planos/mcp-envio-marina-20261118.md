# Plano — envio de WhatsApp pelo MCP delegado (Grok Bot da Marina)

Data: 18/11/2026 (horário de São Paulo, UTC-3). Base lida: `main` em `c3f4c9150` (#53), tags até `v1.88.0-felpz.20`.
Status: **PLANO**. Nada implementado, nada aplicado no banco ou no servidor, sem PR.

## 1. O que existe hoje (lido no código)

- **Rota** `app/api/mcp/delegacao/route.ts` → `lib/auth/delegacao-http.ts` (JSON-RPC: `initialize`, `tools/list`, `tools/call`).
  As ferramentas são três: `delegacao_buscar`, `delegacao_ler` e `delegacao_baixar`. O `scopes_supported` do well-known é `buscar/ler/baixar`.
- **Identidade.** `verificarSujeitoOAuth` (`lib/auth/delegacao-oauth-sujeito.ts`) só aceita um JWT com `role=oauth_delegado` e `client_id` autorizado.
  Recusa `dsk_`, cookie e `authenticated`. O client PostgREST é o JWT da pessoa (`createUserClientFromAccessToken`), então a RLS vale.
- **Autorização** (`lib/auth/delegacao-superficie.ts`):
  - Grant vivo em `delegacao_visibilidade_corporativa` (uid + client + org, `efeitos`, `expires_at`, `revoked_at`). O `grantVivo` exige `efeitos.includes(efeito)`.
  - Origem empresarial pelo vínculo da sessão em `delegacao_sessoes_empresariais` (conta empresarial; sessão nova herda pelo `conta_id`).
    Sessão sem vínculo (desconhecida) e sessão pessoal recusam. `is_personal=false` sozinho não basta.
  - `avaliarContatoPessoalDaConversa`: contato pessoal recusa.
  - A recusa devolve 404 opaco, e o log leva só um resumo opaco (`resumoOpacoDelegado`, org em hash).
- **Banco (0774).** O CHECK de `efeitos` só aceita `buscar/ler/baixar`. O papel `oauth_delegado` só tem SELECT (sem INSERT/UPDATE em `messages`).
- **Em produção hoje.** Há 1 grant vivo com `{buscar,ler,baixar}`, válido até fev/2027. A titular é membro ativo da org com papel `manager`.
  Há 3 sessões vinculadas à conta empresarial. A assinatura automática da org (`settings.assinatura_mensagens`) está desligada.
- **Caminho de envio do CRM.** `sendMessageHandler` (`app/api/v1/messages/_handler.ts`), usado pelo Inbox, por `POST /api/v1/messages` e pela tool `crm_send_whatsapp_message` (`lib/mcp/tools/messages.ts`). Ele já faz:
  - veto de contato bloqueado e de contato pessoal (spec 21);
  - janela 24h;
  - canal arquivado ou desativado → `failed`;
  - sessão fora de WORKING → `queued`;
  - pré-go-live/modo de teste do canal, só para ator não humano;
  - adapter WAHA (`resolveRecipient`) e gravação em `messages` com `sent_via` derivado do ator (`origemDaMensagem`).
- **Retentativas.**
  - O redrive do watchdog (`lib/agent-engine/edge/crm/session-reconciler.ts`) só reenvia `sent_via in ('ai','automation','system')`.
  - O cron `recover-stuck-messages` não reenvia nada.
  - Logo, `sent_via='user'` **nunca é reenviado automaticamente**.
- **Freios que já existem.**
  - `checkRateLimit` (Redis, janela fixa).
  - `segurarEnvioPorToken`/`registrarEnvioPorToken` (`lib/messaging/ritmo-do-envio-por-token.ts`): espaçamento + teto diário do número, via `pacing_ledger`.
  - Idempotência `comIdempotencia` (`lib/api/idempotency.ts`, tabela `idempotency_keys`).
- **check-exists.** Existe em `WahaClient.checkContactExists` e no adapter (`resolveRegisteredPhone`), mas o handler de texto **não** o chama hoje.
- **Convenção do prefixo.** Os envios humanos da Marina já saem como `*Marina*: texto`: são ~98 pelo aparelho (`external_device`) e 4 pelo CRM (`user`, com autor).

## 2. Desenho proposto

### 2.1 Ferramenta nova `delegacao_enviar`

Entrada (zod estrito):
- `conversation_id`: uuid.
- `texto`: 1–4096 caracteres, sem o prefixo, porque o servidor é quem põe.
- `idempotency_key`: uuid, **obrigatória**.
- Opcional, **só se Felipe liberar arquivo** (decisão D1): `anexo: { bucket, path, legenda? }`.
  Aceita apenas um objeto que a própria Marina pode baixar pela superfície (mesma checagem do `delegacao_baixar`). **Nunca URL externa.**

Saída: `{ status, message_id, external_id, sent_at, deduplicated }`, sem corpo, telefone ou nome.

### 2.2 Ordem das checagens (fail-closed; qualquer falha recusa sem enviar)

1. **Sujeito OAuth.** `verificarSujeitoOAuth`, como hoje.
2. **Grant vivo com `enviar` no `efeitos`.** Ter só leitura não dá envio. O grant de leitura continua igual.
3. **Conversa e origem empresarial pelo JWT da Marina (RLS).** É o mesmo `origemCorporativa`: sessão vinculada, contato não pessoal.
   Como prova de visibilidade, isso vem **antes** de qualquer client privilegiado.
4. **Regras extras do envio:**
   - `is_group=false`, a menos que D2 libere grupos;
   - contato não bloqueado;
   - sessão `WORKING` e não arquivada nem desativada. Senão recusa, em vez de deixar `queued`, para não haver envio tardio surpresa;
   - membership ativa da titular na org com papel ≥ `agent`, relida no servidor.
5. **Teto da delegação** (D3): por grant, por hora e por dia (`checkRateLimit` `deleg:env:h:<grant>` / `deleg:env:d:<grant>`). Depois vem o freio do número (`segurarEnvioPorToken`), o mesmo de token/MCP.
6. **check-exists** via `adapter.resolveRegisteredPhone` (duas grafias do nono dígito).
   - Número inexistente → recusa `numero_inexistente`, sem linha em `messages`.
   - Conversa só com `@lid` → usa o caminho do adapter (`resolvePhoneForLid`); se não resolver, recusa.
7. **Envio único** pelo `sendMessageHandler`, sob `comIdempotencia` (endpoint `mcp:delegacao_enviar`, org + chave):
   - `actor = { type: "user", id: <uid da Marina>, role }` → `sent_via='user'` e `sent_by_user_id` da Marina. É o mesmo registro de quando ela digita no Inbox, e o redrive não reenvia;
   - `body = "*Marina*: " + texto`. O prefixo é fixo no servidor, com o nome tirado de config (D4), e não do bot. A assinatura da org continua desligada, então não duplica;
   - `metadata.origem = "delegacao_bot"`, `metadata.oauth_client_id_hash`, `metadata.idempotency_key`.
   Retentativa com a mesma chave devolve o mesmo recibo (`deduplicated: true`). Mesma chave com corpo diferente dá 409. **Nenhum retry dentro da ferramenta.** Erro do WAHA vira `failed` e é devolvido ao bot.
8. **Auditoria.** `audit()` com os códigos novos `delegacao.mensagem_enviada` e `delegacao.envio_recusado` (em `lib/audit/actions.ts`, no fim da lista).
   Campos: ator = uid, org, conversa, message_id, external_id, client_id em hash e motivo. **Sem texto, telefone nem token.**
   O log de aplicação continua opaco.

**Modo de teste e bloqueios.** Ficam todos os bloqueios do handler: pessoal, bloqueado, janela, arquivado, desativado, `canal-pausado`/`central-de-pausa` se aplicável a humano. Somam-se a eles:
- um interruptor de instalação `DELEGACAO_ENVIO_HABILITADO`, desligado por padrão: sem ele a tool nem aparece no `tools/list`;
- uma lista opcional `DELEGACAO_ENVIO_ALLOWLIST_CONVERSAS`, para a fase piloto.

### 2.3 Por que não chamar o WAHA direto nem dar INSERT ao `oauth_delegado`

- **Chamar o WAHA direto** pularia todos os vetos do handler e a gravação em `messages`.
- **Dar INSERT ao papel** exigiria policies de escrita em `messages`/`conversations`/`pacing_ledger`/`idempotency_keys` para o papel delegado. É uma superfície grande e difícil de provar.
- **Proposta:** um módulo **isolado** `lib/auth/delegacao-envio.ts` usa `createAdminClient()` **só depois** que as etapas 1–4 passaram com o JWT da pessoa. Rota e HTTP continuam sem admin.
  O teste de isolamento passa a permitir o admin apenas nesse arquivo e exige que ele só seja chamado após `origemCorporativa` ok (cerca estática + teste unitário).

A confirmação "posso enviar?" do lado da Marina é responsabilidade do bot dela. O servidor só garante as regras acima.

## 3. Arquivos

### Mudam
- `lib/auth/delegacao-superficie.ts`: `EFEITOS_DELEGADOS` + `enviar`; motivos novos (`grupo_nao_permitido`, `sessao_indisponivel`, `numero_inexistente`, `teto_envio`, `envio_desligado`, `membro_inativo`).
- `lib/auth/delegacao-http.ts`: tool `delegacao_enviar` com `inputSchema` real; `scopes_supported` + `enviar`; status 429 para teto e 404 opaco para o resto; resposta sem PII.
- `lib/auth/delegacao-oauth-consentimento.ts`: rótulo do escopo `enviar` ("Enviar mensagens pela conta empresarial") na tela `/oauth/consent`.
- `lib/audit/actions.ts`: dois códigos novos.
- `lib/i18n/dicionario.ts`: textos novos.
- `lib/env.ts`: `DELEGACAO_ENVIO_HABILITADO`, tetos e allowlist.
- `.env.example` / `docs/self-host`: as variáveis novas.
- `lib/auth/delegacao-mcp-isolamento.test.ts`: cerca nova (admin só em `delegacao-envio.ts`).
- `CHANGELOG.md` e `.changes/`: entrada felpz.21.
- `docs/decisoes/delegacao-papel-dedicado.md`: adendo do efeito `enviar`.

### Novos
- `lib/auth/delegacao-envio.ts`: etapas 4–8.
- `lib/auth/delegacao-envio.test.ts`.
- `supabase/migrations/2026111xxxxxxx_0775_delegacao_efeito_enviar.sql`: só troca o CHECK de `efeitos` para aceitar `enviar`, idempotente. **Não** muda `fn_delegacao_grant_vivo` (leitura continua exigindo efeito de leitura) e **não** dá grant de escrita ao papel. É o próximo número depois da 0774, que é a última da árvore.
- `supabase/rollback/0775_delegacao_efeito_enviar.sql`: volta o CHECK. Antes, tira `enviar` dos grants (UPDATE) para o CHECK antigo validar.
- `supabase/baseline.sql`: espelho do CHECK.
- `tests/invariants/delegacao-efeito-enviar.test.ts` (pg): o CHECK aceita `enviar`, o papel continua sem INSERT/UPDATE em `messages`, e a 0775 reaplicada não apaga grants.
- `tests/e2e/delegacao-mcp-next.spec.ts` (estender): `tools/call delegacao_enviar` com WAHA de teste do CI. Cenários:
  - **positivos:** sessão empresarial + contato comum, com 1 linha `messages` `sent_via=user` e prefixo; replay com mesma chave sem segunda linha nem segundo POST no WAHA;
  - **negativos:** grant sem `enviar`, sessão pessoal, sessão desconhecida, contato pessoal, grupo, outra org, grant revogado, interruptor desligado, número inexistente (check-exists), sessão não WORKING, teto excedido.
- `docs/handoffs/PR-delegacao-envio.md`.

## 4. Testes e CI

- **Unitários.** Ordem das checagens: nenhum client admin é criado se 1–4 falharem (spy), o prefixo é aplicado uma vez, idempotência (replay/409/em curso), sem retry, resposta e log sem PII.
- **Invariantes pg16/pg17.** Matriz RLS existente intacta + 0775.
- **e2e.** Como acima, sem número real (WAHA do CI).
- **CI.** Workflows `ci` e `e2e` completos verdes (typecheck, lint, channel provider leak, colisão de migration, partes 1–6, RLS, update.sh com dados, e2e).

## 5. Rollout (cada passo com ok do Felipe)

1. PR na `main` do fork, CI verde e revisão.
2. Merge, tag `v1.88.0-felpz.21`, build da imagem.
3. Deploy via **Infra Brisa**. A 0775 entra pelo update padrão; conferir `schema_migrations` e o CHECK.
4. Produção sobe com `DELEGACAO_ENVIO_HABILITADO=false`. Conferir que o `tools/list` continua com 3 ferramentas.
5. Grant: com ok do Felipe, `UPDATE` do grant da Marina para `{buscar,ler,baixar,enviar}` (via service role, registrado no audit).
   A Marina reconecta o conector se o `scope` OAuth precisar incluir `enviar` (D6).
6. Piloto:
   - ligar o interruptor com allowlist de 1 conversa de teste interna da Brisa;
   - 1 envio de teste e conferência de `messages`/audit/WAHA;
   - depois abrir para todas as conversas empresariais.
7. Avisar o Grok Bot do Felipe e o Análise de Inquilinos (dono do conector da Marina).

## 6. Rollback

- **Imediato, sem deploy:** `DELEGACAO_ENVIO_HABILITADO=false` + restart do app, ou revogar só o efeito (`UPDATE` tirando `enviar` do grant). A leitura continua.
- **Código:** voltar para a imagem felpz.20 via Infra (a 0775 é compatível para trás: CHECK mais largo não quebra o .20).
- **Banco (se preciso):** `supabase/rollback/0775_...sql` (tira `enviar` dos grants e volta o CHECK).

## 7. Decisões abertas para o Felipe

- **D1 — Arquivos:** só texto no início, ou também documento/imagem? Se sim, só anexos já existentes no CRM (`whatsapp-media`/`locacao-processos`) ou também arquivo que o bot dela sobe?
- **D2 — Grupos:** proibidos (proposta) ou liberados?
- **D3 — Tetos:** proposta de 20/hora e 80/dia por grant, mais o freio do número que já existe.
- **D4 — Prefixo:** `*Marina*: ` fixo no servidor (proposta, igual ao que ela já usa), ou ligar a assinatura da org para todos os humanos (`*Nome*` na linha de cima, que muda para todo mundo)?
- **D5 — Conversa nova:** só conversas existentes (proposta) ou também iniciar conversa com número novo? Iniciar exige check-exists + criação de contato e aumenta o risco.
- **D6 — Escopo OAuth:** exigir `enviar` também no consentimento OAuth (mais forte, a Marina reconecta) ou só no grant do banco?
- **D7 — Janela de horário:** bloquear envio fora de, por exemplo, 7h–22h? Hoje o envio humano não tem esse limite.
- **D8 — Piloto:** qual conversa interna usar no teste de ponta a ponta.

## 8. Esforço estimado

- **Implementação + testes:** ~1,5 a 2 dias de trabalho de agente (texto só). Arquivo (D1) soma ~0,5 dia.
- **CI:** 2–3 ciclos de ~1 h.
- **Rollout:** merge/tag/deploy/piloto ~2–3 h com a Infra Brisa.
