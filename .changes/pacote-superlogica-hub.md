---
impacto: capacidade_nova
secao: alterado
titulo: Superlógica confronta o pacote 3× e só avisa divergência
---
Com a chave `locacao.pacote_superlogica_habilitado` ligada, o CRM lê aluguel, condomínio, IPTU e seguro-incêndio na Superlógica (só leitura, pelo Hub) para confrontar a ficha. Valor já preenchido (conversa ou manual) permanece. Se diferir, o modal e a ficha mostram aviso por campo (ficha × Superlógica). Só o campo vazio pode receber Superlógica, com origem `superlogica`. Endereço/CEP, quando o Hub trouxer, só entram no aviso. Seguro-fiança continua de fora. Se o Hub não responder, o sistema usa a conversa e avisa. A chave nasce desligada; quem já instalou não precisa editar arquivo. O Hub ainda precisa expor `GET /imovel/pacote`.
