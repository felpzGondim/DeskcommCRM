---
impacto: capacidade_nova
secao: alterado
titulo: Modal de locação mostra FC/Migra, renda completa e padrões de contrato
---

No modal Cadastro e locação, as abas Análise FC e Análise Migra passam a mostrar o resultado (id/status da FC, cotação da Migra) ou o erro em português devolvido pelo servidor (renda não confirmada, valor faltando, ferramenta indisponível no Hub). O código do erro entra no audit. Seguro-incêndio sai da tela, da regra 3× (agora 3 × aluguel + condomínio + IPTU) e do confronto Superlógica; a coluna no banco permanece. A aba Análise de renda hidrata o relatório da última execução (resumo, 3×, checklist) e, ao terminar, recarrega Dados com a renda comprovada — que vence a extraída da conversa. Se a ficha mudou depois da confirmação, dá para confirmar de novo. Preencher pela conversa aplica, só em campo ainda vazio, início em D+5, término em +30 meses, IGPM, taxa de administração 5% e taxa de locação 100%, com selo "padrão". Quem já instalou não precisa editar arquivo.
