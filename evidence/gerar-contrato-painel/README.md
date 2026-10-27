# Gerar contrato pelo painel — 27/10/2026

Foi verificado o componente real `PainelDoAgente`, com o CSS do produto, em Chromium local. Uma bancada temporária Vite montou o componente. Playwright interceptou **somente a resposta da rota de contratos**, com dados fictícios; não houve chamada de criação ao SuperLógica. Portanto as imagens provam a interface, não a disponibilidade ou autorização da API de produção.

- `01-botao.png`: Gerar contrato aparece junto às outras ações do painel.
- `02-previa.png`: dados preenchidos, resumo completo e confirmação bloqueada até marcar a revisão. A preparação fez um único pedido, com etapa `preparar`.
- `03-resultado.png`: após confirmação, o resultado mostra contrato ativo e despesa pendente. A segunda chamada usa etapa `confirmar`.
- `04-mobile.png`: o resultado cabe em uma tela de 390 × 844, sem transbordo horizontal.

Os testes em `tests/unit/painel-contrato-rota.test.ts` exercitam o handler autenticado com banco e Hub simulados: escopo por organização/conversa, confirmação explícita, prévia assinada, bloqueio com pendências, suporte só leitura, auditoria sem conteúdo e repetição da mesma chave após resposta perdida. `painel-contrato.test.ts` verifica assinatura, escopo, expiração e transporte. `gerar-contrato-dialog.test.tsx` verifica revisão, invalidação ao editar, preservação ao fechar, pendências e retomada.

Controle negativo: retirar temporariamente a montagem de `GerarContratoDialog` do painel faz o teste `oferece Gerar contrato no painel e abre a preparação sem gravar` reprovar pela ausência do botão. O componente foi restaurado após a medição.

Verificação: 53 testes passaram nos seis arquivos relacionados (painel, formulário, rota, assinatura/transporte e cobertura de espanhol). Typecheck passou. Lint geral terminou sem erros; o repositório tem avisos preexistentes. Os arquivos desta mudança foram conferidos separadamente. Os verificadores de canais, papéis, fragmentos de release e `git diff --check` também passaram. A suíte completa de testes não foi executada.

Não medido: criação real no SuperLógica, credencial de produção, deploy do CRM, acesso da chave do CRM ao serviço de contratos do Hub, instalação completa com banco fresco. A autorização do serviço e os nomes/formato dos campos foram conferidos no código de `felpzGondim/brisa-hub`, commit `628b43073e0ba63ffb4ad390e06815ecdab3185a` (API `contrato/contrato.py`, OpenAPI e proxy em `app/server.py`).
