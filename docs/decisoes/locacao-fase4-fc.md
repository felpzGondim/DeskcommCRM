# Fase 4.3 — FC Score+ no Painel (dois cliques, laudo, reuso)

**Autorização:** Felipe, 28/10/2026 (Fase 4 e adendo A4); Hub H1/H2/confirmação ainda não aplicados na VPS.
**Forma:** sem migration (a 0770 já criou `locacao_analises_fc` com origem, documento, `login_necessario`). Destino: só este fork.
**Rollback:** desligar `locacao.analise.fc`. Pedidos, score e laudo ficam.

Nada disto manda mensagem a contato. Nada escreve na Superlógica. Sem preço na tela
(`fc_preco` não existe). O agente nunca confirma a cobrança.

---

## O que este PR faz

- Sem renda comprovada o motor do #31 deixa `renda.mensal` e `proposta_fc` em
  `null`. O payload **não assume valor**: `pendenciaDoPayloadFc` e
  `montarArgumentosFc` recusam. Conservador: sem número, não dispara a FC.
- Clique 1: ferramenta `analisar_fc` (L). O agente pode executar. Dispara
  `iniciar_analise_inquilino` com `acao: "fc_salvar"` (grátis, gera o ID-FC).
- Clique 2: ferramenta `confirmar_cobranca_fc` (S). Só o atendente; qualquer
  papel `agent+`. Botão: **«Confirmar cobrança da FC (vai gastar créditos)»**.
  Sem valor. `valor_exibido` não é enviado.
- `status_fc` (L) acompanha; poll de 15 s só em `solicitada`/`cobrando`. Nunca
  chama a confirmação sozinho.
- Reuso: FC `concluida` da mesma pessoa (`cpf_hash`) há ≤ 90 dias. Copia
  score/risco; **não** chama o Hub; **não** copia o laudo (`documento_id`).
- Fiador e solidário: só com clique do atendente (`Pedir FC do fiador`). A IA recusa.
- Lista fechada em `lib/painel/acoes/hub.ts`: H1/H2 + `confirmar_cobranca_fc_analise`.
  Ferramenta ausente → aviso claro, sem o caminho antigo (Migra+FC juntas).
- Cada ação usa `pedido_id` distinto. Confirmar depois de `login_necessario`
  reusa o **mesmo** pedido (o Hub trava cobrança dupla). Um salvamento novo
  depois de `login_necessario` nasceria outro id — este PR **não** abre
  salvamento novo enquanto o último da pessoa está em `login_necessario`.
- Laudo: `baixar_resultado_analise(pedido_id, tipo:"laudo")`, base64 até 2 MB.
  Arquivos do processo desligados → score salvo, laudo não persistido.
- 9a: o botão antigo some quando `locacao.analise.seguro` **e**
  `locacao.analise.fc` estão ligados.
- Tipo do status: `lib/locacao/analise/status-hub.ts` (a 4.2 criou). Lê
  `fc.score` / `fc.risco` aninhados, `id_fc`, `laudo_disponivel` e
  `reconfirmacao`.

## `cobranca_incerta` e `ja_cobrado`

- `ja_cobrado`: idempotente. Nada novo dispara. Tela segue o status.
- `cobranca_incerta`: **não confirmou**. Aviso claro. Estado permanece
  `aguardando_cobranca`. Nunca repetimos sozinhos. O atendente só clica de
  novo se conferiu no Hub.
- Pedido já `concluida`/`reaproveitada`: a confirmação devolve o estado sem
  chamar o Hub.

## O que depende do Felipe (padrão conservador deste PR)

| Tema | O que este PR faz | Pendente |
|---|---|---|
| Solidário | Trata como fiador: só com clique do atendente | Confirmar se colocatário solidário entra no salvamento do locatário |
| Outros locatários (não principal) | Só o locatário principal entra no clique 1 automático | Botão por colocatário? |
| Reuso de 90 dias | Copia score/risco; **não** copia o laudo | O laudo deve ir junto? |
| Arquivos desligados | Salva score; não persiste o laudo | Confirmar se o PDF fica só na sessão |
| `login_necessario` no salvamento | Não abre pedido novo; acompanha o mesmo | Confirmar se o Hub retoma o job |
| `valor_exibido` | Não enviado (não há preço na tela) | Se o Hub passar a exigir, mostrar o quê? |
| Andamento vs reuso | Pedido em curso vence o reuso de 90 dias | — |
| Quem clica o pago | Qualquer atendente (já autorizado) | — |

## Destino

**Núcleo deste fork, desligado.** Se nenhuma organização ligar `locacao.analise.fc`,
a operação comum continua inteira.
