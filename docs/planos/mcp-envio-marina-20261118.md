# Envio de WhatsApp pelo MCP delegado

Decisões de 18/11/2026 às 10h39, horário de São Paulo. Entrega pendente de release `felpz.21`.

| Decisão | Contrato |
|---|---|
| D1 · Arquivos | Encaminhar anexos de `whatsapp-media` e `locacao-processos` que o JWT da titular pode baixar. O bot também pode enviar PDF, JPEG, PNG, WebP, DOC, DOCX, XLS, XLSX, TXT e CSV por base64, até 16 MiB decodificados. Anexos do CRM seguem o limite de 50 MiB da Inbox. O envio usa o bucket privado da Inbox, sob a org e conversa de saída, com nome sanitizado. |
| D2 · Grupos | Grupos visíveis de uma sessão vinculada podem receber. A consulta de registro do número vale para conversas 1:1. |
| D3 · Teto | Até 20 tentativas de entrega por hora e 80 por dia, por titular, somadas entre organizações e clients. As janelas fixas são em UTC. A primeira tentativa que chega à etapa de entrega reserva a quota, inclusive se o transporte falhar. Replay devolve o recibo sem consumir quota. O freio existente do número também se aplica. |
| D4 · Prefixo | `*<nome>*: <texto>` nas sessões empresariais, apenas quando há texto ou legenda e `DELEGACAO_ENVIO_PREFIXO_NOME` tem valor. Preserva o prefixo quando ele já está no início. Na ativação em produção, o valor será `Marina`. A sessão titular envia a mensagem como fornecida. |
| D5 · Conversa nova | A ferramenta pede uma sessão autorizada, número E.164, nome opcional e mensagem. Confirma o número antes de abrir com `openSharedContactConversation`. Contato pessoal ou bloqueado e número sem confirmação recusam. |
| D6 · OAuth | O efeito `enviar` vive no grant CRM. O consentimento continua com `buscar`, `ler` e `baixar`. |
| D7 · Horário | Envio disponível em qualquer horário, sujeito aos tetos e aos vetos do canal e do handler. |
| D8 · Piloto | A conversa interna do primeiro teste ficou sem definição. A instalação controla a ativação pelo interruptor e pelo grant. |
| D9 · Sessão titular | Uma sessão ativa e explicitamente vinculada na organização pessoal da titular, com um membro. A autorização exige membership ativa `admin` ou `owner` e grant vivo. A sessão titular convive com as sessões empresariais de outra org. |

## Entrada, efeito e recibo

`/api/mcp/delegacao` valida o Bearer dedicado e expõe `delegacao_enviar`, `delegacao_iniciar_conversa` e `delegacao_listar_sessoes` com `DELEGACAO_ENVIO_HABILITADO=true`. A listagem retorna ID da sessão, organização, origem e estado. Para enviar, informe `conversation_id` ou `channel_session_id` conforme a ferramenta, a mensagem e uma `idempotency_key` UUID. Em mídia, `legenda` tem precedência sobre `texto`. A legenda pode ser omitida. Os arquivos são fornecidos como `arquivo: {base64,nome,mime}` ou `anexo: {bucket,path}`.

O backend lê todos os grants do par titular/client, consulta a conversa com o JWT sob RLS e confere o efeito da organização retornada pelo banco. `delegacao_buscar` lê até 100 conversas por organização com o efeito correspondente. A RPC de sessão retorna apenas quatro campos e verifica o grant de leitura e o vínculo. Sessões desconhecidas e vínculos titulares de outra pessoa permanecem invisíveis.

O módulo de envio cria o cliente privilegiado após a autorização por RLS, confere o papel da titular, reserva a chave por 24h e verifica destino, sessão e mídia. A chave cobre a abertura da conversa e o envio. O hash de idempotência inclui o SHA-256 dos bytes enviados pelo bot ou a identidade do anexo referenciado. O handler confirma a autorização e grava a bolha da Inbox como `sent_via=user`, com o ID da titular e os metadados `origem=delegacao_bot` e `delegacao_origem`. A autoria humana fica fora do redrive automático.

O recibo traz `status`, `message_id`, `external_id`, `sent_at`, `deduplicated` e `conversation_id`. O `external_id` do recibo e do audit é um SHA-256, pois alguns IDs de transporte contêm o endereço do destinatário. Quando o canal registra falha, o recibo devolve o status da mensagem gravada. Se o aceite ficar incerto, a ferramenta mantém a chave e devolve erro opaco. Uma colisão de corpo ou uma operação em curso volta 409. O servidor usa 401 para identidade, 404 opaco para autorização, 422 para parâmetros e 429 com `Retry-After` e `retry_after` para teto ou freio. Indisponibilidade da quota compartilhada ou da reserva de idempotência interrompe a entrega com 503.

## Operação da instalação

1. Aplicar a 0775 no fluxo normal de atualização do baseline. A migration contém schema. Usar a mesma autoridade de DDL do Storage da 0774.
2. Conferir que a instalação inicia com `DELEGACAO_ENVIO_HABILITADO=false`. Com o interruptor desligado, `tools/list` contém as três ferramentas de leitura.
3. Quando autorizada a ativação, executar [o script de ativação](../../supabase/delegacao-envio-ativar.sql) com as variáveis psql `user_id`, `org_empresarial`, `org_titular`, `sessao_titular` e `oauth_client_id`. Conferir o resultado da transação.
4. Definir o prefixo e ligar o interruptor no app. Combinar a conversa interna do piloto e conferir a bolha da Inbox, o recibo e o audit por `message_id`.
5. Para interromper o envio, desligar o interruptor e reiniciar o app. [A desativação operacional](../../supabase/delegacao-envio-desativar.sql) também restaura o grant empresarial aos efeitos de leitura e revoga o grant e vínculo titulares. [O rollback de schema](../../supabase/rollback/0775_delegacao_envio_sessao_titular.sql) restaura as policies e o CHECK da 0774.
