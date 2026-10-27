# Painel do agente — parte 1 (26/10/2026)

**O que é.** Um painel na coluna direita da conversa (Inbox), logo abaixo do bloco
**Contato**, onde a IA conversa com **quem atende** — nunca com o cliente.

## Decisões do dono (Felipe)

| Decisão | Valor |
|---|---|
| Qual IA responde | A escolhida em **IA › Provedores → "IA do painel do atendente"** (ponto `painel_atendente`). Na Brisa: Gemini. |
| Quem vê | Todo atendente (`agent` ou acima). Suporte em modo só leitura vê os botões desabilitados. |
| O que aparece | Resumir conversa, Sugerir resposta, pergunta livre, consultas do Brisa Hub e Gerar contrato (ver `docs/decisoes/painel-acoes-hub.md`). |
| Cadastro de contrato | Gerar contrato prepara a locação no SuperLógica e exige revisão do resumo antes de confirmar. Manutenção de contratos existentes continua fora deste painel. |

## Regras que não podem quebrar

1. **A IA nunca envia nada.** "Usar como resposta" só preenche a caixa de texto (Composer,
   `ComposerHandle.preencher`), em modo resposta. Quem envia é o atendente.
2. **Nada da conversa do painel é gravado.** O histórico vive só na tela (troca de conversa = painel
   limpo). A auditoria (`api_audit_log`, ação `ai.painel_atendente`) registra só a ação, se respondeu e o
   código de erro — sem texto; o custo fica em `llm_calls` com `purpose = 'painel_atendente'`.
3. **A conversa do cliente vai cercada como dado** (`=== CONVERSA COM O CLIENTE … ===`), com as
   mensagens cortadas em 1.500 caracteres e no máximo as 60 últimas.
4. **Sem ferramentas e sem modelo próprio:** o provedor vem só do ponto `painel_atendente`
   (`ai_purpose_bindings`), e o gasto conta no orçamento do mês (o ponto não é isento).
5. **Limites:** 10 pedidos/min por pessoa e 40/min por organização.
6. Contato anonimizado (LGPD) → o painel recusa (422).

## Arquivos

- `lib/agent-engine/agent/painel-do-atendente.ts` — prompt, bloco da conversa e a chamada ao seam.
- `app/api/v1/conversations/[id]/painel-agente/route.ts` — `POST`, `requireRole("agent")`.
- `components/inbox/PainelDoAgente.tsx` — a tela.
- `components/inbox/CRMSidePanel.tsx`, `Composer.tsx`, `InboxLayout.tsx` — encaixe.
- `lib/ai/pontos/registro.ts` — o ponto `painel_atendente` (aparece em Provedores).
- `lib/audit/actions.ts` — a ação `ai.painel_atendente`.
- Testes: `tests/unit/painel-do-atendente.test.ts`, `tests/unit/painel-do-agente-ui.test.tsx`.

## Banco

**Sem migration.** `ai_purpose_bindings.purpose` e `llm_calls.purpose` são texto livre (sem CHECK),
conferido por leitura no banco em 26/10/2026.

## Sem provedor escolhido

O painel mostra "Nenhum provedor de IA está configurado…" (mesma frase do chat do caso), até alguém
escolher a IA em Provedores.
