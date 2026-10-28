# Fase 4.1 — análise de renda no Painel

**Autorização:** Felipe, 28/10/2026 13:05 (horário de Brasília); 9a depois.
**Forma:** sem migration (a 0770 já criou evento `renda` e as colunas). Destino: só este fork.
**Rollback:** desligar `locacao.analise.renda`. As fichas e os eventos ficam.

Nada disto manda mensagem a contato. Nada escreve na Superlógica. Sem chamada nova ao Hub.

---

## O que este PR faz

- Ferramentas `analisar_renda` (L, gasta modelo, conta no teto análise) e `confirmar_renda` (S, só com clique de qualquer atendente) no registro único.
- Botão e campo /pergunta usam `executarFerramenta`. O agente só propõe `confirmar_renda` via `propor_acao`.
- Reabre PDFs originais (`enriquecerAnexosDaAnalise` / `lerPdfsOriginais`). O texto derivado da ingestão corta em 8 mil caracteres; a análise não depende só dele.
- Regras da skill: autotransferência, poupança e Rende Fácil saem da comprovada; PIX de terceiros fica à parte.
- Grava versão da ficha do processo (`origem preliminar_ia`, campo `renda`) e evento `renda`. Confirmar grava `origem atendente` com `alterado_por` e `renda_confirmada_*`.
- Sem renda confirmada, `exigirRendaConfirmada` recusa os botões 2 e 3 (seguro/FC, PRs futuros).
- Chave `locacao.analise.renda` desligada por padrão. Sem a chave, o Painel da conversa fica como hoje.
- Ponto de IA `painel_analise` (resposta 2a).
- Decisão 9a (botão antigo some) **não** entra aqui: só quando seguro e fc ligarem.

## O que depende do Felipe

- Limiares de renda e a regra 3× o aluguel: **não** viraram bloqueio. Só alerta se o modelo mencionar. Falta decisão.
- Quem confirma: **qualquer atendente** (resposta 8a, nível S). Já implementado.
- Teto de saída: a chamada pede 8192 tokens. Na main de hoje `tetoDeSaida` ainda corta no 4096 da org; o PR #25, se entrar, deixa a chamada pedir mais quando a org não define teto. `finishReason === "length"` vira erro claro.
