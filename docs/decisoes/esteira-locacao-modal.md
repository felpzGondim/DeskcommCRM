# Esteira de locação no modal

Decisão de 29/10/2026. Destino: módulo de locação já distribuído no fork; não acrescenta tabelas ao núcleo. A operação comum de outras organizações permanece igual quando o módulo está desligado.

## Fluxo

Entrada: Cadastro e locação no painel do atendente ou pedido conversacional. O modal reúne Dados → Renda → FC → Migra → Relatório → Contrato → Superlógica → Documentos e relatórios. A aba Documentos fica por último. Não há navegação para outra página de processo dentro do modal.

O formulário permite começar manualmente. Salvar normaliza um campo RENDA por participante e sincroniza a ficha versionada da conversa com o processo ativo. A primeira gravação humana cria o processo quando o módulo está ligado. O interlocutor não é convertido automaticamente em candidato. Os participantes são identificados por CPF, e a renda de uma pessoa não preenche outra.

A renda declarada inicial pode ser substituída pela apuração documental. Correção humana tem prioridade sobre reextrações. FC usa a renda da pessoa consultada; o total familiar não é atribuído ao fiador. Os campos legados mensal/proposta_fc são projeções compatíveis do mesmo valor operacional. Evidências e valores documentais permanecem no relatório e no histórico.

## Arquivos

GET/PATCH /api/v1/conversations/[id]/locacao/documentos valida sessão, papel e organização. Lista mensagens com documentos/imagens em páginas de 100, documentos do processo e relatórios textuais. Abrir e Baixar pedem `redirect=1` na mesma rota: o servidor confere organization_id e assina o objeto por cinco minutos (buckets `whatsapp-media` ou `locacao-processos`), depois responde 302. Sem `redirect=1` devolve JSON `{ url }`. Não copia os originais entre buckets. A tela agrupa por origem: Inquilino (`mensagem`, `anexo_conversa`, `upload_manual`), Ficha cadastral impressa (tipo ainda inexistente no CHECK — ver PR de banco), Laudo da FC (`laudo_fc` / `hub_fc`), Migra (`cotacao_seguro` / `hub_migra`) e Contrato. Grupo vazio mostra "nenhum arquivo ainda". A categoria e o participante dos anexos da conversa ficam no metadata locacao_documentos, separados por processo; documentos gerados usam o vínculo já existente. A atualização de metadata usa comparação para preservar escritas concorrentes.

## Retorno e recuperação

Alterações da ficha invalidam a atualidade do relatório sem apagar seu texto e sinalizam FC/Migra que utilizaram versão anterior. Nenhuma edição emite consulta paga ou reenvia cotação. Protocolo e proteção idempotente existentes continuam sendo usados. Falhas ficam visíveis; documentos indisponíveis não são classificados como ausentes.

Atividade: versões da ficha, eventos do processo e auditoria locacao.documento_classificado. Saída: campos persistidos, relatórios .md, resultados dos fornecedores e contrato pelo fluxo existente. Laço de retorno: correção pelo atendente gera nova versão e sinaliza os resultados afetados.

## Validação

Testes de RENDA por pessoa, preservação humana, ausência de comprovação, relatório com seis seções e isolamento do acesso a documentos. A prova visual e os testes completos do aplicativo continuam necessários antes da implantação. Não executar FC ou Migra paga como teste.
