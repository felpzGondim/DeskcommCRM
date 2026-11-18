# Envio de WhatsApp pelo MCP delegado

Entrega local para `felpz.21`, pendente de release. As decisões, entradas das ferramentas, ativação e reversão estão no [plano de envio](../planos/mcp-envio-marina-20261118.md).

## Integração ao Sistema Vivo

- **Entrada e saída.** `/api/mcp/delegacao` valida JWT, grant e sessão. `sendMessageHandler` grava o outbound e publica `message.sent` em `event_log`. O fluxo está no [mapa de arquitetura](../architecture/delegacao-papel-dedicado.architecture.json).
- **Continuidade.** A mensagem entra na conversa da Inbox com autoria da titular. O handler atualiza a espera na Fila e estende a pausa de IA aplicada a uma resposta humana.
- **Trilha.** `delegacao.mensagem_enviada` e `delegacao.envio_recusado` aparecem no audit após a prova do tenant. Recusas anteriores à elevação de privilégio aparecem no log opaco do MCP. A resposta evita corpo, telefone, nome e token.
- **Próximo passo.** O bot recebe o recibo terminal, o tempo de espera para um novo pedido com a mesma chave ou a recusa. A Inbox conserva o estado exibido ao atendente. O cron de mensagens paradas cobre `sending` e a autoria humana fica fora do redrive.
- **Configuração.** A instalação fornece o interruptor e o prefixo pelo ambiente. O dono liga ou revoga o grant e o vínculo pelos scripts psql documentados. As ferramentas de leitura e envio têm portas no `tools/list`. A Inbox e o Audit usam as portas existentes.
- **Laço de retorno.** A falha de entrega fica na mensagem e no recibo. Um replay consulta a chave em vez de chamar de novo o transporte. Revogar o grant ou o vínculo corta a próxima operação e a última conferência antes de o adaptador enviar.
- **Destino.** Núcleo. A função amplia uma superfície OAuth do produto, compartilha a Inbox e o isolamento RLS da instalação e fica desligada no app até a ativação.

## Prova local

Os unitários cobrem a fronteira OAuth, o recibo, a idempotência, a ordem de checagem e a integração com o handler real da Inbox. A migration inclui o invariante de PostgreSQL para o vínculo titular, reaplicação e ACL. O ambiente contém o cliente `psql`, sem `initdb`, binário servidor ou Docker. A prova visual com o conector e o transporte locais segue pendente.
