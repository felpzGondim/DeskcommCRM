# Fase 4.4 — manual assistido (reserva quando o robô cai)

**Autorização:** Felipe, 28/10/2026 (Fase 4 e adendo A6); decisão 3a: o robô é o caminho normal.
**Forma:** sem migration (a 0770 já criou origem `manual` na análise, `manual_assistido` no documento, chave `locacao.analise.manual`). Destino: só este fork.
**Rollback:** desligar `locacao.analise.manual`. Pedidos, score, cards, laudo e print ficam.

Nada disto manda mensagem a contato. Nada escreve na Superlógica. Nenhum passo pago automático.
Sem dado pessoal em log ou `audit()`.

---

## O que este PR faz

- Reserva automática: com a chave ligada, o painel abre o manual só quando a
  última tentativa da FC ou da Migra está em `erro` ou `login_necessario`.
- Passo a passo do site (FC Score+ / Migra Multi Cálculo PF Residencial) com
  os dados da ficha prontos para copiar. CPF mascarado até o atendente clicar
  em Revelar CPF (nível S, auditoria `locacao.cpf_revelado`, sem o número no
  metadata).
- Formulário para registrar score/risco/ID-FC e os cards da Migra, com anexo
  opcional (laudo/print). Grava no **mesmo** `pedido_id` que o robô abriu,
  `origem=manual`, documento `origem=manual_assistido`. A 4.5 lê esses
  registros iguais aos do robô.
- Ferramentas no registro único: `preparar_manual` (L), `revelar_cpf_manual` /
  `registrar_manual_fc` / `registrar_manual_seguro` (S). A IA não revela CPF
  nem registra. Não chama o Hub.
- Sem renda confirmada, o registro recusa (mesma trava dos botões 2 e 3).
- Arquivos do processo desligados: resultado salvo, anexo não persistido.
- Chave `locacao.analise.manual` desligada por padrão. Sem ela, o Painel da
  conversa fica como hoje.

O CPF claro sai da ficha do processo (`pessoa.cpf.valor`). Não há
`decrypt_cpf` para `locacao_processo_participantes` — ver pendências.

---

## O que depende do Felipe (padrão conservador deste PR)

| Tema | O que este PR faz | Pendente |
|---|---|---|
| Manual sem tentativa do robô | Não abre (só reserva de `erro`/`login_necessario`) | Abrir também quando `fc`/`seguro` estiverem desligados? |
| Leitura do laudo/print pelo Gemini | Não. O atendente preenche o formulário | Auto-preencher a partir do PDF? |
| CPF do participante cifrado | Revela só o valor da ficha. Hash da tentativa que não casa com ninguém da ficha recusa (não escolhe o principal) | RPC `decrypt_cpf` para participante? |
| Arquivo obrigatório | Anexo opcional | Exigir laudo/print para concluir? |
| Score/risco | Aceita o mesmo formato sanitizado do robô (texto curto) | Travado em baixo/moderado/alto? |
| Solidário/fiador | Usa a pessoa da tentativa falha; colocatários só na lista para copiar | Passo a passo próprio por fiador? |
| Novo pedido | Atualiza o pedido falho; não cria linha nova | Pedido novo com origem manual? |

## Destino

**Núcleo deste fork, desligado.** Se nenhuma organização ligar `locacao.analise.manual`,
a operação comum continua inteira.
