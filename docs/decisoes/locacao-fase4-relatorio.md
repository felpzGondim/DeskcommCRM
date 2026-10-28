# Fase 4.5 — relatório financeiro no Painel

**Autorização:** Felipe, 28/10/2026 (Fase 4 e adendo A5); regra da renda no relatório no mesmo dia.
**Forma:** sem migration (a 0770 já criou `relatorio_rascunho*`, `relatorio_aprovado*`, `relatorio_documento_id`, evento `relatorio`, auditoria `locacao.relatorio_rascunho` / `locacao.relatorio_aprovado`, chave `locacao.analise.relatorio`). Destino: só este fork.
**Rollback:** desligar `locacao.analise.relatorio`. Rascunhos, aprovação e documento ficam.

Nada disto manda mensagem a contato. Nada escreve na Superlógica. Nenhum passo pago. Sem Hub.

---

## O que este PR faz

- Ferramentas no registro único: `gerar_relatorio` (L) e `aprovar_relatorio` (S, só com clique de qualquer atendente — decisão 8a).
- Montagem **determinística** de 6 seções (identificação, resumo, crédito, renda, financeira, risco) a partir dos blocos já gravados (ficha/preliminar, FC, seguro, manual). Bloco faltando → seção pendente, sem inventar número.
- Risco só baixo / moderado / alto. Nunca "alugue" / "não alugue". Sem comprovada, o risco **não** sai baixo.
- A seção de renda **consome** um bloco já calculado (tabela mensal + comprovada, ou motivo de não comprovação). Sem bloco, fica pendente. A renda declarada **nunca** vira comprovada.
- O motor que lê o extrato (lançamentos, exclusões, tabela mensal) **não entra neste PR**. Ele mora em `lib/locacao/extrato/` num PR separado sobre a `main`, junto com a correção do relatório preliminar. Este PR lê `ficha.renda.bloco_calculado` ou `ficha.renda.extrato`. Quando aquele PR mesclar, o 4.5 rebaseia para a função canônica.
- Aprovar: qualquer atendente. Se arquivos do processo estiverem desligados, o rascunho permanece (o texto não some) e a aprovação não exige documento.
- Chave `locacao.analise.relatorio` desligada por padrão. Sem ela, o Painel da conversa fica como hoje.
- CPF, telefone, e-mail e RG saem mascarados. Audit sem PII.

## O que este PR não faz

- Não calcula créditos do extrato, não classifica lançamento, não tem prompt de renda.
- Não altera `SYSTEM_DO_RELATORIO_PRELIMINAR` nem `SYSTEM_DA_ANALISE_DE_RENDA`.
- Não reabre PDF nem muda o teto de caracteres das fontes (isso é do motor / preliminar).
- Não recomenda alugar. Não aprova o **processo** (isso continua só do Felipe).

## Sistema vivo (DoD 13)

| Invariante | Artefato |
|---|---|
| Entrada | Botão Gerar relatório / ferramenta `gerar_relatorio` (L) no Painel |
| Saída | Rascunho em `locacao_processos.relatorio_rascunho`; texto nas 6 seções |
| Atividade | Evento `relatorio`; audit `locacao.relatorio_rascunho` / `locacao.relatorio_aprovado` |
| Tela | `ProcessoDeLocacaoPainel` (`data-testid="analise-relatorio"`) |
| Porta | Mesmo painel da conversa; chave em Configurações › Locação |
| Anti-morte | Chave desligada some o botão; bloco ausente deixa a seção pendente |
| Laço de retorno | Aprovar (S) só no clique; rascunho visível para conferir; sem comprovada o risco não baixa |

Mapa: `docs/architecture/locacao-processo.architecture.json` (peça `relatorio`, arestas `e27`/`e28`).

## O que depende do Felipe (padrão conservador deste PR)

| Tema | O que este PR faz | Pendente |
|---|---|---|
| Motor do extrato | Consome bloco pronto; sem bloco, pendente | Rebase quando `lib/locacao/extrato/` entrar |
| Quem aprova o relatório | Qualquer atendente (8a) | Só o Felipe, como a aprovação do processo? |
| Arquivos desligados | Aprova sem documento e **mantém** o rascunho | Exigir arquivos ligados para aprovar? |
| Risco sem FC | Nunca "baixo" se não há comprovada; sem os dois, pendente | Sempre pendente até ter FC? |
| 3× o pacote | Só aparece se o bloco já trouxer o número | Calcular aqui a partir da ficha? |

## Destino

**Núcleo deste fork, desligado.** Se nenhuma organização ligar `locacao.analise.relatorio`, a operação comum continua inteira.
