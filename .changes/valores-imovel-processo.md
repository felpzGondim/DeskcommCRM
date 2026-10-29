---
impacto: capacidade_nova
secao: adicionado
titulo: Valores do imóvel no processo de locação
---

Aluguel, condomínio (inclui rateio), IPTU, seguro-incêndio e seguro-fiança (informativo) passam a viver no processo, pré-preenchidos e editáveis. Superlógica só GET, e só se a chave `locacao.pacote_superlogica_habilitado` estiver ligada (continua desligada). Senão, sai da conversa/ficha. Edição humana grava origem `manual` e não é sobrescrita. 3× = aluguel+condomínio+IPTU+seguro-incêndio; seguro-fiança fica de fora e não é obrigatório. FC e Migra usam esses valores e recusam se faltar um dos quatro, apontando o campo. Formulário `CamposImovelProcesso` na ficha preliminar (a aba Dados do modal entra em outro PR). Chaves da Fase 4 continuam desligadas. Rollback: as colunas ficam; o código deixa de exigí-las.
