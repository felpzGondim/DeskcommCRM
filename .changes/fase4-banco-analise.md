---
impacto: capacidade_nova
secao: adicionado
titulo: Base da análise de inquilino no processo (desligada)
---

O processo de locação passa a ter um registro de cotação de seguro-fiança (pedido, job, estado, resultado), tipos de evento renda e relatório, e chaves `locacao.analise.{renda,seguro,fc,relatorio,manual}` — todas desligadas. Sem preço da FC no banco. A confirmação da cobrança continua avisando que vai gastar créditos, sem valor na tela. Rollback: desligar as chaves; as tabelas ficam.
