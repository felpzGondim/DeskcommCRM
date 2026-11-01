---
impacto: capacidade_nova
secao: alterado
titulo: 3× da locação pode ler o pacote na Superlógica via Hub
---
Com a chave `locacao.pacote_superlogica_habilitado` ligada, aluguel, condomínio, IPTU e seguro-incêndio do teste 3× vêm da Superlógica (só leitura, pelo Hub). Seguro-fiança continua de fora. Se o Hub não responder, o sistema usa os valores da conversa e avisa. A chave nasce desligada; quem já instalou não precisa editar arquivo. O Hub ainda precisa expor `GET /imovel/pacote`.
