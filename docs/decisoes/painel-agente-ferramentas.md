# Painel do agente — campo /pergunta com ferramentas (28/10/2026)

**O que é.** O campo livre do Painel do agente passa a poder chamar as **mesmas**
ações dos botões, via um registro único. Botões continuam atalho barato (sem
modelo). A chave nasce **desligada**.

O PR #20 (processo de locação) já está na `main` (`9787d8ec`). Este recorte não
depende de branch empilhado.

## Decisões do dono (Felipe)

| # | Decisão | Valor |
|---|---|---|
| 1 | Modelo | O do ponto `painel_atendente` (Provedores). Na Brisa: Gemini. |
| 2 | Passos | 6 no modo normal; 10 com análise (anexo/FC/relatório). |
| 3 | Custo / tempo | US$ 0,05 / 45s normal; US$ 0,30 / 120s com análise. Rate limit e `ai_budgets` iguais. |
| 4 | No limite | Responde com o que já apurou e oferece **Continuar**. |
| 5 | Boletos | Ligados, **só leitura**. Nunca gerar/alterar/enviar. |
| 6 | Quem usa | Todo atendente (`agent`+), desde o primeiro dia em que a chave estiver ligada. |
| 7 | Registro | `agent_panel_query_log`: pergunta, resposta, ferramentas, parâmetros (sem PII), passos, tokens, custo, duração, `parou_por`, atendente. Entra na cascata LGPD. Multi-tenant + RLS. |
| 8 | Retenção | 1 ano (piso no corpo de `fn_expurgar_consultas_do_painel_vencidas`). |
| 9 | Análise paga | O agente só **propõe**. O clique no painel aprova o custo, como hoje. |
| 10 | Contrato | Qualquer atendente confirma. Clique humano; o agente pode preparar a prévia e nunca confirma sozinho. Sem lista `aprovador_user_ids` neste recorte. |
| 11 | Sugestão | “Usar como resposta” só preenche o Composer. A IA nunca envia ao cliente. |
| 12 | Caminho único | Botão e agente passam por `executarFerramenta(nome, ctx, args)`. Sem lógica paralela. |
| 13 | Níveis | L o loop executa; C e S o loop só propõe (`propor_acao`); P não existe. Ferramenta futura entra ligada no registro, mas o nível de segurança vale sempre. |
| 14 | Visão | Leitura de anexo no agente, conta no teto de análise. |
| 15 | Andamento | Polling de `etapa_atual` no registro (`GET ?consulta_id=`), a cada 400 ms. |

## Chave (kill switch)

`organizations.settings.painel_agente.ferramentas_habilitado`. Ausente = desligado.
A migration **não liga**. Superfície: Configurações › Locação. Rollback: desligar;
a tabela fica.

Com a chave desligada, o campo /pergunta é o de hoje (sem tools, `SYSTEM_DO_PAINEL`).
Os botões **não** dependem desta chave.

## Caminho único

```
botão  ──origem:"botao"──┐
                         ├── executarFerramenta ── registro (L/C/S)
agente ──origem:"agente"─┘         │
                                   ├── L: executa
                                   └── C/S + origem agente: recusa; o modelo só chama propor_acao
```

Clique humano em C/S (preparar/confirmar análise, Gerar contrato) entra no mesmo
registro com `origem: "botao"`.

## Andamento

O cliente gera um UUID `consulta_id`, manda no POST, e faz GET na mesma rota com
`?consulta_id=` enquanto `carregando === "pergunta"`. A linha em
`agent_panel_query_log` recebe `etapa_atual` a cada ferramenta. Chave desligada:
o GET devolve 404 e a tela mostra “Pensando…”.

## O que isto NÃO faz

- Não envia mensagem ao cliente.
- Não escreve na Superlógica pelo loop do modelo.
- Não confirma contrato nem dispara FC/Migra sozinho.
- Não liga a chave em produção.
- Não cria tabela de processo (isso é a Fase 3, já na `main` pelo #20).

## Arquivos

- `lib/painel/ferramentas/registro.ts` — o registro.
- `lib/painel/ferramentas/executar.ts` — a porta única.
- `lib/painel/ferramentas/loop.ts` — ToolSet L + `propor_acao`.
- `lib/painel/consulta.ts` — abre/fecha o registro e lê o andamento.
- `lib/painel/chave.ts` — kill switch.
- `app/api/v1/conversations/[id]/painel-agente/route.ts` — POST pergunta + GET polling.
- `app/api/v1/settings/painel-agente/route.ts` — GET/PATCH da chave (admin).
- `components/inbox/PainelDoAgente.tsx` — polling, Continuar, cartões, Usar como resposta.
- Migration `0769` + apêndice no `baseline.sql`.
