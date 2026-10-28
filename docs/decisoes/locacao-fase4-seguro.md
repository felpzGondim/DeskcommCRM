# Fase 4.2 — cotação de seguro-fiança no Painel

**Autorização:** Felipe, 28/10/2026 (Fase 4 e adendo A3); Hub H1/H2 ainda não aplicados.
**Forma:** sem migration (a 0770 já criou `locacao_analises_seguro`). Destino: só este fork.
**Rollback:** desligar `locacao.analise.seguro`. Pedidos, cards e prints ficam.

Nada disto manda mensagem a contato. Nada escreve na Superlógica. Nunca Contratar.
Nunca `fc_salvar` nem laudo da FC.

---

## O que este PR faz

- Ferramentas `analisar_seguro` e `status_seguro` (ambas L, cotação gratuita: o agente executa).
- Botão e `/pergunta` usam `executarFerramenta`. Não entram em `propor_acao`.
- Trava `exigirRendaConfirmada` antes de qualquer efeito.
- Lista fechada em `lib/painel/acoes/hub.ts`: `iniciar_analise_inquilino` (só se o schema anunciar `acao`), `status_analise_inquilino`, `baixar_resultado_analise`. Com a chave do Hub desligada, as ferramentas novas respondem como inexistentes — mensagem clara, sem disparar o caminho antigo (Migra+FC juntas).
- Cada ação usa `pedido_id` distinto. O Hub deduplica pelo trio (organização, conversa, pedido_id). Reaproveitar o mesmo id só para repetir a **mesma** cotação. FC (4.3) nascerá com outro id.
- Print em base64 na resposta (até 2 MB). Sem arquivos do processo ligados, os cards são salvos e o print não.
- Tela: cards sanitizados. **Não mostra score nem risco** (são da FC).
- 9a: o botão antigo «Iniciar análise de inquilino» some só quando `locacao.analise.seguro` **e** `locacao.analise.fc` estiverem ligados. Este PR só liga o toggle de seguro; com fc desligado o botão antigo permanece.

## Tipo do status (preparado para 4.3)

`status_analise_inquilino` passará a devolver `score` e `risco` do FC como campos **opcionais** (decisão do Felipe, 28/10/2026). O tipo e o parser moram em `lib/locacao/analise/status-hub.ts` — a 4.3 importa dali, sem puxar a cotação. Ausência (Hub de hoje, null, vazio, tipo errado) vira `null`. A 4.2 **não** os persiste em `resultado` nem os mostra na tela.

## O que depende do Felipe (padrão conservador deste PR)

| Tema | O que este PR faz | Pendente |
|---|---|---|
| Arquivos desligados | Salva cards, não persiste print, avisa o atendente | Confirmar se o print deve ficar só na sessão |
| Vigência e solidários | **Não** enviados no payload (o schema H1 anunciado não pede) | Confirmar se o Hub precisa de início=+5d / 30 meses e colocatários |
| Retry após `login_necessario` | Novo clique gera **novo** `pedido_id` | Confirmar se o Hub retoma o mesmo job |
| Score/risco no status | Parseados e descartados na 4.2 | 4.3 usa os campos na tela da FC |
| Cotação gratuita via agente (L) | Já autorizado (Felipe) | — |

## Destino

**Núcleo deste fork, desligado.** Se nenhuma organização ligar `locacao.analise.seguro`, a operação comum continua inteira.
