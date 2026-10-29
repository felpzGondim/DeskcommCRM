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
- Motor canônico: `fontesDaFicha` → `prepararFontesDoRelatorio` (familiares da ficha + extrator por IA) → `lib/locacao/extrato`. A classificação por regex (`regras.ts`) foi aposentada.
- Entram na comprovada: salário/pró-labore/holerite; PIX/TED de terceiros (inclusive avulsos, com recorrência por pagador); vendas no cartão/maquininha.
- Saem, com volume à parte: próprias (mesmo CPF/nome); familiares diretos da ficha; poupança/resgates/aplicações/Rende Fácil; estornos; empréstimos. Familiar só por sobrenome/nome parcial vai para "familiar provável — conferir", com a renda com e sem.
- 3× = aluguel + condomínio + IPTU + seguro-incêndio (sem seguro-fiança). Sem prova, `renda.mensal` fica `null` — o declarado não preenche.
- Grava `renda.bloco_calculado` (reais) para o relatório 4.5. Grava versão da ficha do processo (`origem preliminar_ia`) e evento `renda`. Confirmar grava `origem atendente` com `alterado_por` e `renda_confirmada_*`.
- Sem renda confirmada, `exigirRendaConfirmada` recusa os botões 2 e 3 (seguro/FC).
- Chave `locacao.analise.renda` desligada por padrão. Sem a chave, o Painel da conversa fica como hoje.
- Decisão 9a (botão antigo some) **não** entra aqui: só quando seguro e fc ligarem.

## O que depende do Felipe

- Quem confirma: **qualquer atendente** (resposta 8a, nível S). Já implementado.
- A regra de renda acima é a das 20:57, já no motor do #31. Este PR não cria variante.
