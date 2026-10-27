---
impacto: capacidade_nova
secao: adicionado
titulo: Painel do agente consulta o Brisa Hub e pede análise com confirmação
---
O painel do agente ganhou ações para consultar boletos, contrato e ficha cadastral usando o servidor MCP externo cadastrado pela organização. Para boletos, o atendente não digita CPF: pode preencher no Composer um pedido de três dígitos ao cliente e consultar depois da resposta. A ficha usa somente um JSON temporário dos anexos da conversa; considera documento de identidade e comprovante de renda (holerite, CTPS ou extrato bancário), sujeitos à conferência humana. O pedido de documentos só preenche a caixa de resposta. A análise relê a conversa e os PDFs originais, mostra uma prévia interna com dados e renda por documento e só habilita a confirmação quando há fontes conferíveis. Confirmar cria um job idempotente no Brisa Hub para Migra e preparo da FC; a etapa cobrada da FC exige outra confirmação no serviço. Nenhuma ficha automática do cliente é gravada no CRM. O Hub precisa ser atualizado e configurado para anunciar as novas ferramentas; se alguma não estiver disponível, o painel explica a pendência.
