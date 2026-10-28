# Fase 4 — análise de inquilino (PR 4.0, banco)

**Autorização:** Felipe, 28/10/2026 13:05 (horário de Brasília), respostas no plano.
**Forma:** um PR de banco (0770). Destino: só este fork. Sem merge, tag ou deploy daqui.
**Rollback:** desligar `locacao.analise.*`; as tabelas ficam (mesmo critério da Fase 3).

Nada disto manda mensagem a contato, nada escreve na Superlógica, nada dispara
passo pago no FC. Sem dado pessoal neste arquivo. Sem preço da FC no banco
(resposta 5: a confirmação só avisa que vai gastar créditos).

---

## O que a 0770 cria (e o que não cria)

| Peça | Decisão |
|---|---|
| Tabela `locacao_analises_seguro` | 1a: pedido, job do Hub, estado, resultado — igual à `locacao_analises_fc` |
| Eventos `renda` e `relatorio` | 4.1 e 4.5 gravam sem nova migration |
| Origem `manual` na ficha; `manual_assistido` no documento | 4.4 grava no mesmo lugar que o robô, com origem marcada |
| `login_necessario` na FC; origem `hub`/`manual` na FC | 4.3 e 4.4 |
| Colunas de renda confirmada e rascunho/aprovação do relatório no processo | 4.1 e 4.5 |
| Chaves `locacao.analise.{renda,seguro,fc,relatorio,manual}` | Todas **false**. A migration não liga nada. Cada uma exige `processos_habilitado`. |
| Preço da FC | **Não entra.** Sem `fc_preco`, sem configuração de valor. |

Índice único parcial: uma cotação `solicitada`/`cotando` por processo. A FC
continua com o índice por `cpf_hash` em andamento (anti-cobrança dupla).

---

## Decisão LGPD por tabela tocada

A cascata canônica (`fn_lgpd_cascade_redact_contact`) **não** ganha passo
novo — o mesmo desenho da 0767: gatilho INVOKER em `contacts`. Quem cobre
é `fn_locacao_limpar_contato_anonimizado`, nos dois caminhos:

- **Anonimização:** `AFTER UPDATE OF is_anonymized` (`trg_locacao_limpar_contato_anonimizado`).
- **Exclusão:** `BEFORE DELETE` (`trg_locacao_limpar_contato_excluido`).

| Tabela | Decisão | Por quê |
|---|---|---|
| `locacao_analises_seguro` | **Redigir** (gatilho). Sem FK para `contacts` (é do processo, como a cotação da Migra). `resultado` jsonb some quando um locatário/solidário/fiador do processo é anonimizado ou apagado. A linha fica (histórico da tentativa, sem o dado). Retenção de 90 dias também zera. | Cards da cotação podem trazer identificação indireta; o titular que pediu apagamento não deixa cotação legível. |
| `locacao_analises_fc` | **Redigir** (gatilho, 0770 amplia a 0767). `resultado` e `cpf_hash` zerados quando o participante daquela tentativa é o contato. | Laudo e hash ligam a pessoa. |
| `locacao_processos` (`relatorio_rascunho`) | **Redigir** (gatilho). O rascunho das 6 seções some quando locatário/solidário/fiador do processo é anonimizado ou apagado. Papel `contato` (só conversa) **não** apaga o relatório. | O relatório nomeia a pessoa. |
| `locacao_processo_fichas` origem `manual` | Sem mudança de decisão. Já era redigida na retenção (delete das fichas) e a ficha versionada não tem FK para `contacts`. | — |
| `locacao_processo_eventos` tipos `renda`/`relatorio` | **Manter.** `detalhe` continua só ids, versões e caminhos. | Já era a regra da 0763. |
| `locacao_processo_documentos` origem `manual_assistido` | **Redigir** (já na 0767): documentos do participante saem na virada. | Laudo/print são arquivo da pessoa. |

Prova: `tests/invariants/locacao-analises-seguro-lgpd.test.ts` e o isolamento em
`tests/invariants/locacao-processos-rls.test.ts`.

Exportação do titular: continua a contar processos/pessoas/arquivos, sem CPF
nem texto de cotação (`lib/lgpd/copia-do-titular.ts`). A 4.0 não muda o PDF.

---

## Como desfazer o banco

Bloco escrito, **não roda sozinho**. Apagar a tabela exige um ok novo do Felipe,
com exportação antes.

```sql
-- só com ok novo. não entra em update.sh.
drop trigger if exists trg_locacao_limpar_contato_excluido on public.contacts;
drop table if exists public.locacao_analises_seguro;
-- as colunas novas em locacao_processos / locacao_analises_fc ficam até um
-- forward-fix pedido; desligar as chaves já esconde a Fase 4 da operação.
```

Produção: gravar `false` em `locacao.analise.*`. O painel volta ao de hoje.

---

## Destino

**Núcleo deste fork, desligado.** Se nenhuma organização ligar as chaves, a
operação comum continua inteira — as tabelas existem vazias, como na Fase 3.
