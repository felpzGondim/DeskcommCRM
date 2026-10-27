# Gerar contrato pelo painel — 27/10/2026

Foi verificado o componente real `PainelDoAgente`, com o CSS do produto, em Chromium local. Uma bancada temporária Vite montou o componente. Playwright interceptou **somente a resposta da rota de contratos**, com dados fictícios; não houve chamada de criação ao SuperLógica. Portanto as imagens provam a interface, não a disponibilidade ou autorização da API de produção.

- `01-botao.png`: Gerar contrato aparece junto às outras ações do painel.
- `02-previa.png`: dados preenchidos, resumo completo e confirmação bloqueada até marcar a revisão. A preparação fez um único pedido, com etapa `preparar`.
- `03-resultado.png`: após confirmação, o resultado mostra contrato ativo e despesa pendente. A segunda chamada usa etapa `confirmar`.
- `04-mobile.png`: o resultado cabe em uma tela de 390 × 844, sem transbordo horizontal.

Os testes em `tests/unit/painel-contrato-rota.test.ts` exercitam o handler autenticado com banco e Hub simulados: escopo por organização/conversa, confirmação explícita, prévia assinada, bloqueio com pendências, suporte só leitura, auditoria sem conteúdo e repetição da mesma chave após resposta perdida. `painel-contrato.test.ts` verifica assinatura, escopo, expiração e transporte. `gerar-contrato-dialog.test.tsx` verifica revisão, invalidação ao editar, preservação ao fechar, pendências e retomada.

Controle negativo: retirar temporariamente a montagem de `GerarContratoDialog` do painel faz o teste `oferece Gerar contrato no painel e abre a preparação sem gravar` reprovar pela ausência do botão. O componente foi restaurado após a medição.

Verificação inicial: 53 testes passaram nos seis arquivos relacionados (painel, formulário, rota, assinatura/transporte e cobertura de espanhol). Typecheck passou. Lint geral terminou sem erros; o repositório tem avisos preexistentes. Os arquivos desta mudança foram conferidos separadamente. Os verificadores de canais, papéis, fragmentos de release e `git diff --check` também passaram.

## Correções encontradas ao preparar a publicação

A suíte completa iniciada antes dos ajustes finais passou em 28.527 casos e falhou em cinco: dois guardas da interface e dois casos do preparo do ffmpeg foram corrigidos e passaram no reteste; um validador de chave excedeu o timeout local. O CI seguinte passou nas sete partes de `verify`, em `invariants`, em build e nos testes de boot das imagens. O resultado atualizado do CI fica no PR #8.

O e2e identificou dois testes que procuravam globalmente o botão **Sugerir resposta**. O painel interno tem outro botão com esse nome, que chama uma rota diferente. O seletor passou a cobrir explicitamente o compositor e o bloco **Assistência do agente**. O navegador local confirmou, usando os componentes reais, que o seletor antigo é ambíguo nos dois estados (com e sem rascunho), e que o novo encontra um único botão e chama somente `/draft-reply`. A rede dessa prova foi simulada; as asserções originais dos testes de ponta a ponta foram preservadas. O teste unitário monta compositor e painel juntos para guardar essa coexistência.

Também foi medido limite de tráfego nos registros GHCR e ECR ao preparar o Supabase. O CI passou a autenticar o GHCR com permissão de leitura e a priorizar o Docker Hub oficial, cujas sete referências foram verificadas. A parte 6 já tinha passado antes com 17m41s de suíte; a execução que gastou 538s de preparo foi cortada sem caso vermelho. Priorizar o registro disponível reduz a espera; não amplia o teto de 30 minutos nem remove casos.

Após esses ajustes, 44 testes direcionados passaram em seis arquivos, além da prova de seleção no navegador. Typecheck e lint dos arquivos alterados passaram. A execução completa do CI deve encerrar antes de integrar e publicar.

Não medido: criação real no SuperLógica, credencial de produção, deploy do CRM, acesso da chave do CRM ao serviço de contratos do Hub, instalação completa com banco fresco. A autorização do serviço e os nomes/formato dos campos foram conferidos no código de `felpzGondim/brisa-hub`, commit `628b43073e0ba63ffb4ad390e06815ecdab3185a` (API `contrato/contrato.py`, OpenAPI e proxy em `app/server.py`).
