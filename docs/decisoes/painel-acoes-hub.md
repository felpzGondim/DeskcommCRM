# Ações do painel do agente via Brisa Hub

O painel fica na Inbox, abaixo de Contato. A rota `painel-agente/acoes` exige `agent+`, lê a conversa e o contato pela sessão e por `organization_id`, e usa o cadastro MCP externo da mesma organização. O segredo permanece nas colunas `mcp_externo_chave_*`; a saída usa o cliente MCP e os cabeçalhos de identidade já existentes. Não há chamada direta ao endpoint de produção embutida no código. Cada organização configura seu servidor em Configurações → Servidor MCP externo.

## Contrato exigido do Hub

O arquivo `lib/agent-engine/agent/painel-acoes-hub.ts` concentra os nomes aceitos. O Hub precisa anunciar no `tools/list` e aceitar `tools/call`:

| Botão | Nome aceito (por ordem de preferência) | Entrada | `structuredContent` exigido |
|---|---|---|---|
| Buscar boletos | `segunda_via_boleto`, `buscar_boletos` | `{}` | `boletos: [{ situacao, vencimento, valor }]` (somente abertos/segunda via) |
| Consultar contrato e inquilino | `consultar_contrato_inquilino` **ou** `buscar_contrato` + `buscar_inquilino` | `{}` para cada leitura | `contrato: { imovel, valor, vencimento, situacao }`; a ferramenta combinada devolve `inquilino_situacao`, ou `buscar_inquilino` devolve `situacao` |
| Ficha cadastral / pedir documentos | `buscar_cadastro`, `buscar_ficha_cadastral` | `{}` | `documentos_faltantes: string[]` |
| Iniciar análise | `brisa_hub_analise`, `iniciar_analise_inquilino` | `{ pedido_id: UUID, conversa_id: UUID }` | O Hub deve retornar sucesso após aceitar o pedido |

As três ferramentas de consulta precisam anunciar `annotations.readOnlyHint: true`; sem isso, o botão recusa a chamada. O Hub identifica o inquilino **pelo telefone do contato da conversa** em `X-Deskcomm-Contato-Telefone`, acompanhado de `X-Deskcomm-Contato-Id` e `X-Deskcomm-Canal`. Nunca requer CPF digitado pelo atendente; nunca usa identidade enviada pelo navegador. O Bearer do cadastro identifica a organização no Hub, que deve aplicar seu próprio isolamento. Ausência de telefone, ferramenta ou formato estruturado tem mensagem visível e não derruba o painel.

Para análise, o Hub deve disponibilizar a ferramenta do serviço `brisa-hub-analise`, anunciar `pedido_id` e `conversa_id` no `inputSchema`, disparar FC Score+ e Migra e **deduplicar pelo par organização + conversa + `pedido_id`**. O CRM reserva o mesmo pedido na tabela existente `idempotency_keys` antes de chamar o Hub e devolve replay por 24 horas; o Hub também precisa deduplicar para cobrir perda de resposta após aceitar o trabalho. Se a operação for assíncrona, o Hub deve disponibilizar andamento em `status` e dar uma referência consultável ao operador. A interface só confirma que o pedido foi aceito; não afirma que a análise terminou.

O texto livre retornado pelo Hub não é mostrado. As consultas exibem somente campos estruturados selecionados. CPF, telefone completo, nomes e chaves não entram na auditoria. A sugestão de documentos só chama `ComposerHandle.preencher`; a ação não envia mensagem. A confirmação da análise acontece na tela antes do POST. Limites de 10/min por pessoa e 40/min por organização compartilham o contador do painel da parte 1; auditoria usa `ai.painel_atendente.<acao>` com sucesso/replay, sem payload.

Destino: núcleo, como consumidor opcional da capacidade MCP externo. Sem servidor configurado, a Inbox continua útil e as ações explicam a dependência. Entrada: botões em `PainelDoAgente`; saída: resposta visível no mesmo painel e, para documentos, Composer. Auditoria: `api_audit_log`. Não há demanda automática aberta nas consultas; se o Hub falha, a tela mostra o erro para o atendente tentar novamente ou corrigir a configuração. A integração pode ser ajustada em Configurações → Servidor MCP externo. O estado da análise fica sob responsabilidade do Hub até que exista consulta de andamento integrada.
