# Fase 3: entidade "processo de locação" (plano detalhado para o Felipe validar)

> Este documento é só um plano. Nada foi criado no banco, no código, na VPS ou no repositório.
> Escrito em 28/10/2026 (horário de Brasília). Não contém dados pessoais: os exemplos são fictícios.
> Ele **refina** a §4 e a Fase 3 do plano-mestre `docs/planos/processo-de-locacao.md` (PR #16) e respeita
> as decisões já tomadas: Q3, Q10, Q11, Q15 e o adendo (a–i).
>
> **Atualização 28/10 01:05 (Brasília):** o Felipe decidiu que o id da pessoa na Superlógica fica **no contato**
> do CRM (pergunta 11 respondida: lado do contato). O casamento automático contato ↔ Superlógica pelo telefone
> virou uma fase própria, a **Fase 3.5** ([`fase3-5-vinculo-superlogica.md`](fase3-5-vinculo-superlogica.md)). A Fase 3 só deixa o campo e o gancho prontos.

---

## 0. O que foi medido antes de escrever (só leitura)

| Item | Resultado |
|---|---|
| Última migration no checkout da VPS (`/root/deskcommcrm/supabase/migrations`) | **`20261023230258_0761_importacoes_de_historico.sql`**. A próxima livre é a **0762**. |
| Reserva já planejada | O `painel-agente/PLANO.md` §6 cita uma possível **0762 `painel_agente_execucoes`**. Se ela entrar antes, a Fase 3 começa em 0763. Regra: usar o próximo número livre **no dia** e rodar `pnpm checar:colisao-de-migration`. |
| Versão em produção | `system_version`: atual **v1.88.0-felpz.7**, disponível felpz.8. O `.env` da VPS também fixa felpz.7. |
| Tabelas de locação no banco | **Nenhuma** (`locacao*` / `processo*`: 0 tabelas). |
| Superlógica nas migrations | Nenhuma coluna `superlogica_*` existe hoje. |
| Funções SECURITY DEFINER que qualquer usuário logado (`authenticated`) pode executar | **54** hoje (o número antigo era 47). Nenhuma está aberta para `anon`. A Fase 3 **não cria nenhuma nova** dessas. |
| `organizations.settings` da Brisa | Chaves atuais: llm, tags, routing, branding, proposals, mcp_externo, notificacoes, visibility_mode, base_de_conhecimento, canonical_conversation_tags. A chave `locacao` **ainda não existe** (é só uma proposta do plano-mestre). |
| `catalog_products` da Brisa | 4 itens, todos com `codigo`. Origens: `manual` e `superlogica_feed`. O `codigo` vem do ListingID do feed e é comparado normalizado. O id do imóvel na Superlógica **não** fica gravado no catálogo. |
| Padrão de anexos existente | `crm_lead_attachments`, com as policies `tenant_isolation_*_select`, `tenant_isolation_*_write` e `support_write_insert/update/delete`. A Fase 3 copia esse padrão. |
| Botões do painel hoje (`painel-agente/acoes`) | `boletos`, `contrato` (situação), `ficha`, `analise` (preparar/confirmar). A rota separada `painel-agente/contrato` faz Gerar contrato (preparar/confirmar). |
| Problema real no código atual | O botão Análise manda como `telefone` do candidato o telefone **do contato da conversa**. Quando quem conversa é parente ou corretor, o telefone vai errado. A Fase 3 corrige isso: cada pessoa usa o próprio contato. |
| Hub `/contrato/preparar` | Aceita `imovel: {id_imovel}` **ou** `{endereco, numero, complemento}`, além de `locatarios[{cpf, principal, fracao, dados}]` e `fiadores[{cpf}]`. O `/confirmar` devolve `locatarios: [id_pessoa_pes…]`. A API não documenta o vínculo fiador↔contrato, então o fiador vai na observação. |
| Hub análise | Um candidato por job (solidários vão como cópia). O job é idempotente por `(organization_id, conversa_id, pedido_id)`. A cobrança da FC só acontece no passo `confirmar-cobranca-fc`. O Hub apaga o job 5 dias depois de criado e marca erro após 24 h sem atividade. |

---

## 1. Várias pessoas por processo

### 1.1 Papéis

Cada processo tem N pessoas. Cada pessoa é **uma linha** em `locacao_processo_participantes`, com um papel:

| Papel | Quem é | Entra no contrato? | Faz FC/Migra? |
|---|---|---|---|
| `locatario` | Inquilino. Um deles é o **principal**. | Sim | Sim (FC, pago) |
| `solidario` | Co-locatário ou devedor solidário | Sim, como locatário com fração | Sim (FC). Na Migra entra como solidário. |
| `fiador` | Fiador | Vai na observação (limite da API) | Opcional (pergunta 7) |
| `contato` | **Só conversa**: parente, corretor, assistente | Não | Não |

- O campo `relacao` (só para `contato`) aceita: `parente`, `corretor`, `conjuge`, `empresa`, `outro`.
- `principal` é verdadeiro em exatamente 1 locatário quando o contrato for preparado. Isso é checado no código ao preparar, como o Hub já exige. O banco não trava antes porque o processo pode estar incompleto.
- `fracao` (0–100) é opcional até o contrato. Na hora de preparar, a soma dos locatários e solidários tem de dar 100. A sugestão automática divide por igual.
- **Interlocutor** (decisão Q3): quem negocia não é necessariamente parte do contrato. Ele vira uma linha com papel `contato` e marcação `interlocutor_principal = true` (no máximo 1 por processo). Se o próprio inquilino é quem conversa, ele aparece **uma vez só**, como `locatario`, com `interlocutor_principal = true`. Isso substitui a coluna `interlocutor_contact_id` do plano-mestre e evita duas fontes da mesma informação (pergunta 2).

### 1.2 WhatsApp, contato do CRM e Superlógica de cada pessoa

- `contact_id` aponta para `contacts`. O WhatsApp da pessoa é o do contato (`contacts.phone_number`). **Não** se copia o telefone para a tabela nova.
- O campo pode ficar vazio enquanto a pessoa não tem WhatsApp conhecido. Exemplo: fiador que só mandou documento pelo inquilino.
- **O id da pessoa na Superlógica mora no contato, não no processo** (decisão do Felipe, 28/10). Ele fica na tabela
  `contato_superlogica_vinculos` (seção 6.1), ligada a `contacts`. A pessoa do processo **herda** o id pelo `contact_id`:
  não há cópia nem coluna própria no participante. Se o vínculo do contato muda, todos os processos já enxergam o novo.
- Consequência: quem entra no contrato (locatário, solidário, fiador) precisa ter um contato no CRM na hora do
  "Gerar contrato". Se a pessoa não tem WhatsApp, o atendente cria um contato **sem telefone** (o CRM já aceita isso).
- O que a Fase 3 grava no vínculo (sem casamento automático):
  1. depois do `/contrato/confirmar` (clique humano), os ids que voltam em `locatarios: [ids]` (na ordem dos
     locatários enviados) são gravados no contato de cada locatário com origem `contrato_confirmar`, **só se** o contato
     ainda não tiver vínculo. Se tiver um vínculo **diferente**, nada é sobrescrito: vira um item de revisão;
  2. o atendente liga ou desliga à mão (botão no painel do contato e na pessoa do processo), com registro de quem e
     quando, sem valores pessoais no log.
- O casamento em massa pelo telefone (todos os contatos × pessoas da Superlógica), a lista de revisão de casos ambíguos
  e o relatório de simulação ficam na **Fase 3.5** ([`fase3-5-vinculo-superlogica.md`](fase3-5-vinculo-superlogica.md)).
- O CPF fica em `cpf_hash` (para achar duplicados e travar FC dupla) e em `cpf_mascarado` (ex.: `***.***.**9-25`, para a tela).
  - O CPF completo, se for guardado, fica em `cpf_encrypted`, no mesmo esquema de `contacts.cpf_encrypted` (pergunta 4).
  - No dia a dia, o CPF completo vive dentro da ficha versionada (seção 3), sob retenção de 90 dias.

### 1.3 Uma pessoa em vários processos

- Pode acontecer, por exemplo, quando alguém é fiador de dois inquilinos ou tenta dois imóveis.
- A unicidade é **por processo**: a mesma pessoa não se repete no mesmo processo com o mesmo papel. Ela pode estar em quantos processos quiser.
- Na conversa, o painel mostra "esta pessoa também está nos processos X e Y". Mostra só o imóvel e a etapa, sem dados pessoais.
- FC: se a mesma pessoa (`cpf_hash`) teve FC concluída há pouco tempo, o sistema **reaproveita** o resultado e não cobra de novo (seção 4.4).

### 1.4 Uma conversa ligada a vários processos

- Nova tabela N:N `locacao_processo_conversas` (processo ↔ conversa). Exemplos:
  - O corretor conversa sobre 3 imóveis: uma conversa, 3 processos.
  - O inquilino e o fiador têm conversas separadas: um processo, 2 conversas.
- Quando a conversa tem mais de um processo aberto, o painel abre com um **seletor** "Processo: Rua X, apto Y (Documentos)". O padrão é o último usado (`ultimo_uso_em` na ligação). Nenhuma ação (análise, contrato) roda sem um processo escolhido.
- A tabela `conversations` (do upstream) **não** recebe coluna nova. Tudo fica na tabela de ligação, o que reduz a divergência.

### 1.5 Como o atendente cria e liga pessoas (fluxo de tela)

1. Na conversa, no painel, o atendente clica em **"Novo processo"**. O processo nasce com:
   - o imóvel (seção 2);
   - o contato da conversa como primeira pessoa. O atendente escolhe o papel: "é o inquilino" ou "só conversa (parente/corretor)".
2. **"Adicionar pessoa"** oferece três caminhos:
   - (a) escolher um contato existente do CRM (busca por nome ou telefone, como já existe no CRM);
   - (b) criar um contato novo com nome e WhatsApp. Usa a rota de contatos que já existe, com a mesma checagem de duplicado por telefone;
   - (c) "sem WhatsApp", só com nome. Depois pode ser ligado a um contato.
3. O relatório preliminar (IA) **sugere** pessoas a partir dos documentos. Exemplo: "achei RG de outra pessoa: adicionar como solidário?". Nada entra sozinho: o atendente confirma cada uma.
4. **"Ligar esta conversa a um processo existente"** serve, por exemplo, quando o fiador escreve de outro número.
5. Tirar uma pessoa é exclusão lógica (`removido_em`), que fica no histórico. A linha só some de verdade na retenção.

Quem pode: papel `agent` ou superior, com `requireSupportWrite` em toda escrita. O `organization_id` vem sempre da sessão, nunca do corpo do pedido.

---

## 2. Imóvel do processo

### 2.1 Proposta: tabela `locacao_imoveis` (recomendada)

Um imóvel aparece em vários processos ao longo do tempo (cada novo inquilino, cada tentativa recusada). Por isso ele ganha tabela própria, sem dado pessoal. Endereço de imóvel da carteira não é dado de pessoa.

Identidade, em ordem de força:
1. `superlogica_imovel_id` (o `id_imovel` que o Hub aceita no `/contrato/preparar`). É o melhor: elimina a busca por endereço no Hub.
2. `catalog_product_id`, quando o imóvel está no catálogo (feed `superlogica_feed` ou manual).
3. `chave_endereco`: endereço normalizado (veja 2.2).

### 2.2 Normalização do endereço

Uma função TypeScript pura (`lib/locacao/endereco.ts`, com testes) monta `chave_endereco` assim:
- minúsculas, sem acento, só letras, números e espaço;
- tipo de logradouro padronizado: "r." → "rua", "av." → "avenida", "al." → "alameda", "trav." → "travessa";
- número só com dígitos (e sufixo de letra, se houver);
- complemento padronizado: "apto 14", "ap. 14", "apartamento 14" → "ap 14"; "bloco b" → "bl b"; "casa 2" → "cs 2";
- formato: `rua exemplo|100|ap 1|<cep só dígitos ou vazio>` (exemplo fictício).
- O CEP entra na chave **só se** estiver presente nos dois lados. Na comparação, ausência de CEP não diferencia imóveis.

`codigo_fc` continua sendo gerado como o Hub já faz (primeira palavra da rua + número do apto). Ele é **só para a FC**, não é identidade.

### 2.3 Duplicados

- Índice único `(organization_id, chave_endereco)`.
- Índice único `(organization_id, superlogica_imovel_id)` quando preenchido.
- Índice único `(organization_id, catalog_product_id)` quando preenchido.
- Antes de criar, o painel mostra "imóveis parecidos" (mesma rua e número, complemento diferente) e o atendente escolhe: **usar este** ou **é outro**.
- Se dois cadastros forem o mesmo imóvel, há o botão **"juntar"** (só admin). Ele move os processos para um e apaga o outro, e o histórico registra.
- Ao ligar com o catálogo, o código procura por `catalog_products.codigo` normalizado, do mesmo jeito que o sync do Hub já faz. Ele **não** altera `catalog_products`.

### 2.4 Alternativa mais simples (se o Felipe preferir)

Não criar `locacao_imoveis`. Guardar `imovel_endereco`, `imovel_identidade` e `imovel_codigo_fc` direto no processo, como o plano-mestre previa.
- Ganho: uma tabela a menos.
- Perda: sem visão "todos os processos deste imóvel", e duplicados mais difíceis de achar. (Pergunta 3.)

---

## 3. Ficha: relatório preliminar → correção do atendente → versões

### 3.1 Onde mora

- `locacao_processo_fichas`: **uma linha por versão**. Só se acrescenta; nunca se edita nem se apaga, exceto pela retenção.
- `locacao_processos.ficha_versao_atual` (int) aponta para a versão vigente.
- A ficha é o JSON do A.6b (`versao: "preliminar-v1"`, `candidatos[]`, `fiadores[]`, `renda`, `imovel`, `garantia`, `vigencia`, `documentos`, `pendencias`). Cada valor continua como `{valor, fonte, trecho}`.
- Mudança da Fase 3: cada pessoa da ficha ganha `participante_id`, que liga a pessoa da ficha à linha de participante.

### 3.2 Quem mudou o quê e quando

Cada versão grava:
- `versao` (1, 2, 3…) e `base_versao` (a versão que o atendente estava vendo);
- `origem`:
  - `preliminar_ia` (relatório preliminar)
  - `atendente` (edição na tela)
  - `hub_fc` / `hub_migra` (resultado que preenche campos)
  - `contrato` (dados ajustados no Gerar contrato)
- `alterado_por` (usuário) e `alterado_em`;
- `campos_alterados`: lista **só dos caminhos**, por exemplo `["candidatos[0].email", "imovel.aluguel"]`. **Nenhum valor** vai nessa lista, nem no `audit()`. Os valores ficam só dentro das versões, que são apagadas pela retenção.

Concorrência: se `base_versao` não for a versão atual, a gravação falha com "outra pessoa alterou a ficha, recarregue". Não há sobrescrita silenciosa.

Tela: "Histórico da ficha" lista versão, quem, quando e quais campos mudaram. Um botão "ver como estava" abre uma versão antiga, só leitura.

### 3.3 Reuso

A versão atual da ficha alimenta todos os destinos. Cada envio grava **qual versão foi usada** em `locacao_processo_eventos`:
- ficha cadastral (botão `ficha`)
- FC (botão `analise`)
- cotação Migra
- `/contrato/preparar` (botão Gerar contrato)

Assim dá para saber, por exemplo, que "a FC rodou com a versão 3".

### 3.4 Campos por pessoa x por processo

**Por pessoa** (ficam em `candidatos[]`/`fiadores[]` da ficha, ligados por `participante_id`):
- nome, CPF, e-mail, celular (cópia do contato no momento), nascimento, RG, profissão, empregador
- endereço atual (endereço, número, complemento, bairro, CEP, cidade, UF)
- renda individual e fontes
- papel, principal, fração

**Por processo** (topo da ficha):
- imóvel (com ligação a `locacao_imoveis`), aluguel, IPTU, condomínio, tipo (residencial/comercial)
- garantia, valor da caução, seguradora, apólice, valor mensal do seguro fiança
- vigência: início, fim, prazo em meses, dia de vencimento, índice de reajuste
- split, isenção de multa em meses, taxa de administração, taxa de locação, observação
- renda proposta para a FC (`renda.proposta_fc`), documentos encontrados e faltantes, pendências

Novidade em relação ao A.6b: entram na ficha os campos que o `dadosContratoSchema` atual já exige e a ficha não tinha: `indice_reajuste`, `split`, `isencao_multa_meses`, `taxa_adm`, `taxa_locacao`, `iptu.valor_mensal`, `seguro_fianca.valor_mensal`, `apolice` e `observacao`.

### 3.5 Tabela de mapeamento (ficha → destino)

| Campo da ficha | Ficha cadastral | FC (Hub `iniciar_analise_inquilino`) | Migra | `/contrato/preparar` |
|---|---|---|---|---|
| `candidatos[i].nome` | nome | `candidato.nome` | `nome` | `locatarios[i].dados.nome` |
| `candidatos[i].cpf` | cpf | `candidato.cpf` | `cpf` | `locatarios[i].cpf` |
| `candidatos[i].email` | email | `candidato.email` | `email` | `locatarios[i].dados.email` |
| celular **do contato do participante** | celular | `candidato.telefone` (corrige o bug atual) | `telefone` | `locatarios[i].dados.celular` |
| `candidatos[i].nascimento` | nascimento | `data_nascimento` | — | `dados.nascimento` |
| `candidatos[i].rg`, `profissao` | rg, profissão | `rg` | — | `dados.rg`, `dados.profissao` |
| `candidatos[i].endereco…` | endereço atual | — | — | `dados.endereco/numero/complemento/bairro/cep/cidade/uf` |
| `candidatos[i].papel = solidario` | marcado como solidário | job próprio, se for fazer FC | `solidarios[]` | entra em `locatarios[]` com fração |
| participante `principal` / `fracao` | — | — | — | `locatarios[i].principal` / `fracao` |
| `fiadores[j].cpf` (+dados) | fiador | opcional (pergunta 7) | — | `fiadores[j]` (vai para a observação) |
| `renda.mensal` / `renda.proposta_fc` | renda | `renda.mensal` | `renda` | — |
| `imovel` → `locacao_imoveis` | endereço do imóvel | `codigo_fc`, `logradouro`, `apartamento`, `aluguel` | `logradouro`, `numero`, `complemento`, `cep`, `aluguel`, `iptu`, `condominio` | `imovel.id_imovel` **se** houver `superlogica_imovel_id`; senão `imovel.endereco/numero/complemento` |
| `imovel.aluguel` | aluguel | `aluguel` | `aluguel` | `aluguel` |
| `imovel.tipo` | tipo | `tipo_imovel` | `tipo_imovel` | `tipo` |
| `garantia.tipo` / `caucao_valor` / `seguradora_preferida` | garantia | — | (decide se cota) | `garantia` / `caucao_valor` / `seguradora_fianca` |
| `vigencia.inicio/fim/prazo/dia_vencimento` | — | — | `inicio`/`fim` | `data_inicio` / `data_fim` / `prazo_meses` / `dia_vencimento` |
| `contrato.indice_reajuste`, `split`, `isencao_multa_meses`, `taxa_adm`, `taxa_locacao`, `observacao` | — | — | — | mesmo nome |
| `contrato.iptu_mensal`, `seguro_fianca_mensal`, `apolice` | — | — | — | `iptu.valor_mensal`, `seguro_fianca.valor_mensal`, `apolice` |

Observação: o schema do CRM aceita hoje só `imovel.endereco`. Para usar `id_imovel`, precisa de uma mudança pequena no `dadosContratoSchema` (o Hub já aceita).

---

## 4. Status e etapas

### 4.1 Etapas visíveis (o que o atendente vê)

`status` em `locacao_processos` (texto + CHECK):

| status | Significa |
|---|---|
| `lead` | Processo aberto, interesse no imóvel |
| `documentos` | Recebendo e conferindo documentos e dados |
| `analise` | FC e/ou Migra em andamento |
| `aprovado` | **Felipe aprovou** (ato manual, Q10) |
| `reprovado` | Felipe ou atendente recusou, com motivo |
| `contrato_preparado` | `/contrato/preparar` devolveu `pronto` e há um preview válido |
| `contrato_criado` | `/contrato/confirmar` gravou na Superlógica (tem `superlogica_contrato_id`) |
| `contrato_assinado` | Marcado à mão quando o contrato foi assinado (não há API de assinatura, decisão h) |
| `cancelado` | Desistência, imóvel alugado para outro, ou expirado (`motivo_cancelamento`) |

- O passo `contrato_criado` foi incluído porque "preparado" e "assinado" não cobrem o meio: gravou na Superlógica, mas ainda não assinou (pergunta 5).
- O detalhe fino do plano-mestre (renda_conferida, fc_pendente, fc_pronta, seguro_pendente, seguro_pronto, relatorio_pronto) **não** vira status. Vira **marcadores derivados**, mostrados como selos no card: "FC: 1 de 2 prontas", "Seguro: cotado", "Relatório: pronto". Eles saem das tabelas de análise e dos eventos. Assim o status continua simples.

### 4.2 Transições e quem move

| De → Para | Quem/o quê move |
|---|---|
| (novo) → `lead` | Atendente: "Novo processo" |
| `lead` → `documentos` | Automático quando chega o 1º documento/anexo ligado ao processo, ou o atendente move |
| `documentos` → `analise` | Automático quando o atendente clica **"Gerar análise"** e confirma (o clique é o que autoriza a cobrança FC, decisão c) |
| `analise` → `documentos` | Atendente (faltou documento) |
| `analise`/`documentos` → `aprovado` | **Só Felipe** (permissão de admin/dono). Nada aprova sozinho (Q10). |
| `analise`/`documentos`/`aprovado` → `reprovado` | Felipe ou atendente, com motivo obrigatório |
| qualquer etapa até `aprovado` → `contrato_preparado` | Automático quando `/contrato/preparar` volta `pronto: true`. Q10: Gerar contrato está **sempre disponível**, mesmo sem aprovação; o painel só avisa "processo ainda não aprovado". |
| `contrato_preparado` → etapa anterior | Automático quando o preview expira (validade do Hub) ou a ficha muda depois do preparo |
| `contrato_preparado` → `contrato_criado` | Automático quando a confirmação feita **pelo clique humano** no painel volta `gravado: true` |
| `contrato_criado` → `contrato_assinado` | Atendente/Felipe marca à mão |
| qualquer não final → `cancelado` | Atendente/Felipe (motivo), ou rotina de expiração (pergunta 6) |
| `reprovado`/`cancelado` → `documentos` | Só Felipe ("reabrir") |

- Finais: `contrato_assinado`, `reprovado`, `cancelado`. A contagem da retenção começa ao entrar num deles (seção 5).
- Onde a regra vive: um mapa de transições em `lib/locacao/status.ts` (com testes), usado pelas rotas. O banco tem o CHECK dos valores. Toda mudança grava um evento em `locacao_processo_eventos` (de, para, quem, quando, motivo). Não há função SECURITY DEFINER para isso.

### 4.3 Ligação com os botões do painel

| Botão | O que muda com a Fase 3 |
|---|---|
| **Ficha** | Lê e grava a versão atual da ficha do processo escolhido |
| **Gerar análise** (preparar → confirmar) | Uma análise **por pessoa** que precisa de FC. Usa o telefone do contato de cada pessoa. O `pedido_id` vem de `locacao_analises_fc` (não é mais um UUID novo a cada clique). Move para `analise`. |
| **Contrato** (situação) | Igual a hoje (só leitura). Pode usar o id da Superlógica do contato, se houver vínculo. |
| **Gerar contrato** (preparar → confirmar) | Monta o payload pela tabela 3.5 a partir da ficha atual + participantes + imóvel. Preparar → `contrato_preparado`. A confirmação continua sendo **só pelo clique humano** no painel. O assistente nunca chama `/contrato/confirmar`. |
| **Boletos** | Sem mudança |
| Novos: **Aprovar** / **Reprovar** / **Cancelar** / **Marcar assinado** | Aprovar aparece só para o Felipe |

### 4.4 Proteção contra cobrança dupla da FC

Tabela `locacao_analises_fc`, com uma linha por tentativa de FC de uma pessoa.

1. Ao confirmar "Gerar análise", para cada pessoa o servidor abre uma transação e procura uma linha da **mesma organização + mesmo `cpf_hash`**:
   - **Em andamento** (`solicitada`, `aguardando_cobranca`, `cobrando`): **não cria outra**. Devolve "já existe uma FC em andamento para esta pessoa".
   - **Concluída há menos de N dias** (pergunta 8; sugestão: 30): **reaproveita** o resultado, inclusive se foi em outro processo, e não cobra. Grava um evento "FC reaproveitada".
   - **Nenhuma**: cria a linha com um `pedido_id` (UUID) fixo. Cliques repetidos e reenvios usam esse mesmo `pedido_id`, e o Hub já é idempotente por `(org, conversa, pedido_id)`.
2. Trava no banco: índice único parcial `(organization_id, cpf_hash) WHERE estado IN ('solicitada','aguardando_cobranca','cobrando')`. Duas abas clicando ao mesmo tempo → a segunda falha.
3. "Cobrar de novo mesmo assim" (FC vencida ou dado errado): botão só para o Felipe, com motivo, gravado em evento.
4. Continua valendo a idempotência existente da rota (`comIdempotencia`) e o passo separado `confirmar-cobranca-fc` no Hub.
5. Na tabela fica só o mínimo do resultado (situação, score, risco, data, id da solicitação no FC). O laudo completo é um arquivo da Fase 3b.

---

## 5. Integração com a Fase 3b (arquivos), retenção e LGPD

### 5.1 Arquivos

Segue o plano-mestre:
- Bucket privado `locacao-processos`, caminho `{org}/processos/{processo_id}/{categoria}/{id}.{ext}`.
- Tabela `locacao_processo_documentos` no padrão de `crm_lead_attachments` (CHECK do caminho, as mesmas policies).
- Documentos ganham `participante_id` (opcional): "este RG é do fiador".
- Categorias: `documento_pessoal`, `comprovante_renda`, `laudo_fc`, `cotacao_seguro`, `relatorio`, `contrato`, `outro`.
- Decisão (a): arquivos **ficam no CRM**; o Hub recebe só dados.

### 5.2 Retenção

- **Hub: 5 dias.** Já implementado (`RETENCAO_S = 5 dias` desde a criação do job; apaga o job e a pasta de arquivos). A Fase 3 não mexe nisso.
- **CRM: 90 dias**, contados de quando o processo entra em estado final (`contrato_assinado`, `reprovado`, `cancelado`). Processo parado sem atividade por X dias é cancelado como "expirado" (pergunta 6).
- A rotina usa o cron `data-retention` que já existe:
  - uma entrada nova em `lib/retencao/politica.ts`;
  - uma função `fn_expurgar_processos_de_locacao_vencidos` (veja 6.4), seguindo o padrão das 14 `fn_expurgar_*` existentes.
- O que é apagado aos 90 dias:
  - todas as versões da ficha;
  - os arquivos do bucket e as linhas de documento;
  - em `locacao_analises_fc`: o resultado e o `cpf_hash` são zerados;
  - nos participantes: nome, CPF mascarado/criptografado e `cpf_hash` são zerados (`contact_id` fica, se o contato ainda existir).
- O que **fica** (sem dado pessoal), para histórico e números (pergunta 9):
  - id do processo, imóvel, status, datas, `superlogica_contrato_id`;
  - eventos (que já não têm valores pessoais).
- O contato do CRM **não** é apagado pela retenção do processo: ele tem a regra dele.

### 5.3 LGPD (pedido de exclusão ou anonimização de um contato)

- Quando um contato é anonimizado, as linhas de participante ligadas a ele são limpas na hora (nome, CPF, hash). As versões de ficha dos processos onde ele aparece são apagadas e uma versão nova é gravada **sem** os dados dele (origem `lgpd`). Os documentos com aquele `participante_id` são apagados. Os vínculos dele em `contato_superlogica_vinculos` são desligados (`motivo_desfeito = 'lgpd'`) e o id da Superlógica é zerado na linha.
- Como encaixar com pouca divergência:
  - **Opção A (recomendada):** um gatilho nosso em `contacts`, que dispara quando `is_anonymized` vira verdadeiro e chama uma função **SECURITY INVOKER** de limpeza. Não edita a função upstream `fn_lgpd_cascade_redact_contact`.
  - **Opção B:** acrescentar uma chamada dentro da `fn_lgpd_cascade_redact_contact`. Mais explícito, mas gera conflito a cada mudança do upstream nessa função. (Pergunta 10.)
- **Exportação LGPD:** incluir processos, participantes e ficha atual do contato no export existente. É uma mudança pequena no código do export.
- `audit()` nunca leva CPF, nome, telefone ou valores da ficha. Leva só ids, caminhos de campos e status.

---

## 6. Tabelas novas (só no fork do Felipe, Q15)

Convenção:
- Prefixo `locacao_`. `organization_id uuid not null references organizations(id) on delete cascade` em todas.
- `created_at` e `updated_at timestamptz default now()`. Status em `text` + CHECK.
- RLS ligada, com policies no padrão `tenant_isolation_<tabela>_select` / `_write` usando `organization_id in (select fn_user_org_ids())`, mais `support_write_*`, iguais às de `crm_lead_attachments`.

### 6.1 Esquema proposto

**`locacao_imoveis`**
- `id uuid pk`, `organization_id`
- `logradouro text not null`, `numero text`, `complemento text`, `bairro text`, `cidade text`, `uf text`, `cep text`
- `chave_endereco text not null`, `codigo_fc text`, `tipo text check (tipo in ('residencial','comercial'))`
- `catalog_product_id uuid references catalog_products(id) on delete set null`
- `superlogica_imovel_id bigint`, `aluguel_referencia_cents bigint`
- Índices:
  - `unique (organization_id, chave_endereco)`
  - `unique (organization_id, superlogica_imovel_id) where superlogica_imovel_id is not null`
  - `unique (organization_id, catalog_product_id) where catalog_product_id is not null`

**`locacao_processos`**
- `id uuid pk`, `organization_id`, `imovel_id uuid references locacao_imoveis(id) on delete restrict`
- `status text not null default 'lead'` (CHECK com os 9 valores da seção 4.1)
- `status_mudou_em timestamptz`, `motivo_status text` (curto, sem dado pessoal), `motivo_cancelamento text check (in ('desistencia','alugado_outro','expirado','outro'))`
- `ficha_versao_atual int`, `aprovado_por uuid references auth.users`, `aprovado_em timestamptz`
- `superlogica_contrato_id text`, `contrato_preview_expira_em timestamptz`
- `encerrado_em timestamptz` (base dos 90 dias), `created_by uuid`
- Índices: `(organization_id, status)`, `(organization_id, imovel_id)`, `(organization_id, encerrado_em) where encerrado_em is not null`
- Gatilho simples (`updated_at`), SECURITY INVOKER

**`locacao_processo_participantes`**
- `id uuid pk`, `organization_id`, `processo_id uuid references locacao_processos(id) on delete cascade`
- `contact_id uuid references contacts(id) on delete set null`
- `papel text check (in ('locatario','solidario','fiador','contato'))`, `relacao text`
- `principal boolean default false`, `interlocutor_principal boolean default false`, `fracao numeric(5,2)`
- (sem coluna de id da Superlógica: ele vem do contato, via `contato_superlogica_vinculos`)
- `nome_exibicao text`, `cpf_hash text`, `cpf_mascarado text`, `cpf_encrypted bytea` (se a pergunta 4 = sim)
- `removido_em timestamptz`, `created_by uuid`
- Índices:
  - `unique (processo_id, contact_id, papel) where contact_id is not null and removido_em is null`
  - `unique (processo_id, cpf_hash) where cpf_hash is not null and removido_em is null`
  - `unique (processo_id) where interlocutor_principal and removido_em is null`
  - `(organization_id, contact_id)`, `(organization_id, cpf_hash)`

**`contato_superlogica_vinculos`** (lado do contato; criada na Fase 3, vazia; quem enche em massa é a Fase 3.5)
- `id uuid pk`, `organization_id`, `contact_id uuid not null references contacts(id) on delete cascade`
- `superlogica_pessoa_id text not null check (superlogica_pessoa_id ~ '^\d+$')`
- `tipos text[]` (subconjunto de `locatario`, `fiador`, `proprietario`; só informativo)
- `origem text check (in ('manual','contrato_confirmar','casamento_telefone'))`
- `ativo boolean not null default true`, `vinculado_por uuid`, `vinculado_em timestamptz default now()`,
  `desfeito_por uuid`, `desfeito_em timestamptz`, `motivo_desfeito text check (in ('errado','numero_mudou','lgpd','outro'))`
- Índices:
  - `unique (organization_id, contact_id) where ativo` (um vínculo ativo por contato; contato com 2 pessoas = caso de revisão na 3.5)
  - `(organization_id, superlogica_pessoa_id) where ativo` (sem unique: a mesma pessoa pode ter 2 números/contatos)
- Desligar não apaga: marca `ativo = false` com quem/quando. A linha antiga fica como histórico do vínculo.
- Não guarda telefone, nome nem CPF. Só ids.
- Por que tabela e não coluna em `contacts`: não altera tabela do upstream (menos conflito) e guarda o histórico de ligar/desligar.

**`locacao_processo_conversas`** (N:N)
- `id uuid pk`, `organization_id`, `processo_id … on delete cascade`, `conversation_id uuid references conversations(id) on delete cascade`
- `participante_id uuid references locacao_processo_participantes(id) on delete set null`
- `origem text check (in ('criacao','manual','sugestao'))`, `ultimo_uso_em timestamptz`, `created_by uuid`
- Índices: `unique (processo_id, conversation_id)`, `(organization_id, conversation_id)`

**`locacao_processo_fichas`** (versões, só acrescenta)
- `id uuid pk`, `organization_id`, `processo_id … on delete cascade`
- `versao int not null`, `base_versao int`, `ficha jsonb not null`
- `origem text check (in ('preliminar_ia','atendente','hub_fc','hub_migra','contrato','lgpd'))`
- `campos_alterados text[]`, `alterado_por uuid`, `alterado_em timestamptz default now()`
- `unique (processo_id, versao)`
- Policies: **só select e insert** para usuários. Sem update ou delete (a retenção roda como `service_role`).

**`locacao_processo_eventos`** (linha do tempo)
- `id uuid pk`, `organization_id`, `processo_id … on delete cascade`
- `tipo text` (CHECK: status, participante, ficha, analise_fc, migra, contrato_preparar, contrato_confirmar, documento, lgpd)
- `de text`, `para text`, `ator_tipo text check (in ('usuario','sistema','hub'))`, `ator_id uuid`
- `detalhe jsonb` (só ids, versões e caminhos, **nunca** valores pessoais), `created_at`
- Índice: `(processo_id, created_at)`. Só select e insert.

**`locacao_analises_fc`**
- `id uuid pk`, `organization_id`, `processo_id … on delete cascade`, `participante_id … on delete set null`
- `cpf_hash text`, `pedido_id uuid not null unique`, `hub_job_id text`, `ficha_versao int`
- `estado text check (in ('solicitada','aguardando_cobranca','cobrando','concluida','reaproveitada','erro','cancelada'))`
- `reaproveitou_de uuid references locacao_analises_fc(id)`, `autorizado_por uuid`, `autorizado_em`
- `resultado jsonb` (mínimo: situação, score, risco, data), `concluida_em`
- Índices:
  - `unique (organization_id, cpf_hash) where estado in ('solicitada','aguardando_cobranca','cobrando')`
  - `(organization_id, cpf_hash, concluida_em desc)`

**Fase 3b** (já no plano-mestre): `locacao_processo_documentos` + bucket `locacao-processos`, agora com `participante_id`.

Não entram, para reduzir divergência:
- coluna nova em `contacts` (o vínculo com a Superlógica fica em `contato_superlogica_vinculos`, ligado ao contato);
- coluna nova em `conversations`;
- coluna nova em `catalog_products`.

### 6.2 RLS e segurança

- Todas as tabelas: `enable row level security` + policies de isolamento por `organization_id` via `fn_user_org_ids()`.
- Escrita pelo app: só pelas rotas `/api/v1/locacao/...` e do painel, com `requireRole("agent")` + `requireSupportWrite`. Aprovar exige papel de admin/dono. O `organization_id` vem da sessão.
- **Nenhuma função SECURITY DEFINER nova executável por `authenticated`.**
  - Transições, versionamento e anti-cobrança dupla ficam no TypeScript, com os índices únicos como trava final.
  - Gatilhos (`updated_at`, limpeza LGPD) são SECURITY INVOKER.
  - A única SECURITY DEFINER é a de expurgo, com `revoke all from public, anon, authenticated` e `grant execute to service_role`.
- As 54 funções já abertas a `authenticated` ficam como estão. A correção delas é um trabalho separado, que precisa de aprovação própria. A Fase 3 não aumenta esse número, e um teste vai checar isso: contar antes e depois e falhar se subir.
- Teste de isolamento: `pnpm test:db` com 2 organizações, cobrindo leitura, escrita e índices únicos para cada tabela nova.

### 6.3 Numeração e regras do repositório

- Os números saem do próximo livre no dia (hoje 0762, ou 0763 se o painel usar a 0762). Plano de 4 migrations pequenas:
  1. `07xx_locacao_imoveis_processos_participantes_conversas.sql` (inclui `contato_superlogica_vinculos`, vazia)
  2. `07xx_locacao_fichas_e_eventos.sql`
  3. `07xx_locacao_analises_fc.sql`
  4. `07xx_locacao_retencao_e_lgpd.sql` (função de expurgo + gatilho LGPD)
  5. Na Fase 3b: `07xx_locacao_documentos_e_bucket.sql`
- Cada arquivo leva o cabeçalho `-- manifest:` e um apêndice idempotente em `supabase/baseline.sql`. O `MANIFEST.md` não é editado.
- Depois: `pnpm checar:colisao-de-migration` e regerar `lib/database.types.ts`.

### 6.4 Plano de volta (rollback)

- Cada migration tem um bloco "como desfazer" escrito no PR. Ele não roda sozinho. Ordem inversa:
  - `drop trigger` do LGPD em `contacts`
  - `drop function fn_expurgar_processos_de_locacao_vencidos`
  - `drop table locacao_analises_fc, locacao_processo_eventos, locacao_processo_fichas, locacao_processo_conversas, locacao_processo_participantes, locacao_processos, locacao_imoveis, contato_superlogica_vinculos`
  - remover os blocos do `baseline.sql`
- As tabelas são novas e só apontam **para fora** (organizations, contacts, conversations, catalog_products). Se a Fase 3.5 já tiver preenchido vínculos, apagar `contato_superlogica_vinculos` perde esse trabalho: exportar antes (pergunta 12). Apagá-las não toca nenhuma tabela do upstream. A única exceção é o gatilho em `contacts`, que sai primeiro.
- Botão de desligar sem apagar nada: a chave `organizations.settings.locacao.processos_habilitado` (nova, desligada por padrão). Desligada, o painel volta ao comportamento atual (análise ligada à conversa). Desligar é o primeiro passo de qualquer volta. Apagar tabela só com ok explícito.
- Antes de apagar em produção: exportar as tabelas (só para o Felipe, fora do Git) ou aceitar a perda, conforme a pergunta 12.

### 6.5 Divergência com o upstream sob controle

- Tudo novo fica em pastas próprias: `lib/locacao/`, `app/api/v1/locacao/`, `components/locacao/`, `supabase/migrations/*_locacao_*`.
- Arquivos do upstream tocados, só estes (pequenos, um bloco cada):
  - as rotas e componentes do painel (que já são do fork);
  - `lib/retencao/politica.ts` (uma entrada);
  - o export LGPD (um bloco);
  - `lib/database.types.ts` (gerado).
- Antes de cada sincronização com o upstream:
  - rodar o script de colisão;
  - se o upstream usar o mesmo número de uma migration nossa ainda **não aplicada**, renumerar a nossa;
  - se a nossa **já foi aplicada**, primeiro confirmar como o runner registra migrations aplicadas (no banco não existe `supabase_migrations.schema_migrations`). É uma verificação técnica a fazer antes de qualquer renomeação.
- Documentar em `docs/decisoes/locacao-processos.md` a lista exata de pontos de contato com o upstream.

---

## 7. Implantação em passos pequenos e reversíveis

Cada passo vira um PR separado no fork, sem merge automático. Nada vai para produção sem o ok do Felipe.

| Passo | O que entra | O Felipe aprova | Como desfazer |
|---|---|---|---|
| **P0** | Só documentação: este plano no PR #16 (adendo) ou num PR só de docs | O texto e as respostas às perguntas | Fechar o PR |
| **P1** | Migration 1 + RLS + testes de isolamento + chave `processos_habilitado` (desligada). Inclui `contato_superlogica_vinculos` vazia. Sem tela. | Aplicar a migration no banco | `drop` das 5 tabelas (6.4) |
| **P2** | Rotas `/api/v1/locacao/processos` (criar, listar, ligar pessoa e conversa, imóvel com normalização) + aba "Processo" no painel, só para quem tem a chave ligada | Ligar a chave **só na Brisa** | Desligar a chave |
| **P3** | Migration 2 (fichas e eventos) + relatório preliminar gravando a versão 1 + edição com versões + histórico | Aplicar a migration; testar com 1 processo fictício | Desligar a chave; `drop` das 2 tabelas |
| **P4** | Migration 3 (`locacao_analises_fc`) + "Gerar análise" por pessoa, com telefone certo e anti-cobrança dupla | Primeira FC real (custa dinheiro) com um processo escolhido por ele | Desligar a chave; o fluxo antigo volta |
| **P5** | Gerar contrato montando o payload pela ficha (tabela 3.5) + `id_imovel` + gravar o `superlogica_contrato_id` no processo e o id de cada locatário **no contato** (só se o contato não tiver vínculo; se tiver outro, vira revisão) + botão manual ligar/desligar vínculo | Primeiro preparar real. O **confirmar** continua sendo clique dele. | Desligar a chave |
| **P6** | Status, botões Aprovar/Reprovar/Cancelar/Assinado + linha do tempo | Uso por uma semana | Desligar a chave |
| **P7** | Migration 4 (retenção 90 dias + LGPD) + entrada no cron + export LGPD | Aplicar; ver o primeiro expurgo em modo simulado | `drop function`/trigger; tirar a entrada do cron |
| **P8 (3b)** | Documentos + bucket + `participante_id` | Aplicar | `drop` + apagar o bucket vazio |

O deploy na VPS segue o fluxo normal de release (felpz.N), com o Felipe autorizando. Hoje produção está em felpz.7 e há felpz.8 disponível.

### Testes

- **Unidade (Vitest):** normalização de endereço (variações de "apto", acentos, CEP faltando); mapa de transições (todas as permitidas e bloqueadas); montagem do payload do contrato e da FC pela tabela 3.5; diff de ficha (só caminhos, sem valores).
- **Banco (`pnpm test:db`):**
  - isolamento entre 2 organizações em cada tabela;
  - índices únicos: FC dupla simultânea, pessoa repetida, 2 interlocutores principais, imóvel duplicado;
  - fichas sem update/delete;
  - contagem de SECURITY DEFINER não aumenta.
- **Rota:** `organization_id` do corpo é ignorado; agente não consegue aprovar; cliques repetidos em "Gerar análise" geram um só `pedido_id`; FC reaproveitada não chama o Hub.
- **Retenção:** processo encerrado há 91 dias é limpo; há 89, não; um processo aberto nunca é limpo.
- **LGPD:** contato anonimizado some de participantes, fichas e documentos.
- **Manual:** com dados fictícios, num ambiente de teste ou com a chave ligada só para um processo de teste.

### Fora do escopo da Fase 3

- Manutenção (Q11).
- Assinatura eletrônica e envio de e-mails (h).
- Mudanças no Hub, exceto se o `id_imovel` exigir algo; hoje já é aceito.
- Corrigir as 54 funções SECURITY DEFINER antigas.
- Desligar o bot "Análise De Inquilinos", que segue em paralelo (i).
- Painel de relatórios e métricas de processos.
- Juntar contatos duplicados do CRM.
- Vínculo de fiador direto no contrato da Superlógica (a API não documenta).
- Casamento em massa contato ↔ Superlógica pelo telefone, lista de revisão e relatório de simulação: **Fase 3.5** ([`fase3-5-vinculo-superlogica.md`](fase3-5-vinculo-superlogica.md)), logo depois da Fase 3.
- Busca de boletos usando o vínculo: fica para depois (o Felipe pediu para não rodar agora).
- Qualquer chamada automática ao `/contrato/confirmar`.

---

## 8. Perguntas para o Felipe

1. **Fase 3 e 3b juntas?** (pergunta 8 do plano-mestre)
   - (a) PRs separados, na ordem P1…P8 (recomendado)
   - (b) um PR grande só
2. **Quem só conversa (parente/corretor):**
   - (a) entra como pessoa do processo com papel "contato" e marca de interlocutor principal (recomendado)
   - (b) fica numa coluna separada `interlocutor_contact_id`, como no plano-mestre
3. **Imóvel:**
   - (a) tabela própria `locacao_imoveis`, reaproveitada entre processos (recomendado)
   - (b) só colunas dentro do processo
4. **CPF completo das pessoas:** (pergunta 4 do plano-mestre)
   - (a) só dentro da ficha (apaga em 90 dias) + hash e máscara na pessoa (recomendado)
   - (b) também criptografado na linha da pessoa
5. **Etapas:**
   - (a) as 9 da seção 4.1, com "contrato criado" entre preparado e assinado (recomendado)
   - (b) exatamente as que você listou, sem "contrato criado"
6. **Processo parado vira "cancelado/expirado" depois de:**
   - (a) 30 dias
   - (b) 60 dias
   - (c) nunca, só à mão
7. **Fiador faz FC?**
   - (a) sim, sempre
   - (b) só quando o atendente pedir
   - (c) não
8. **Reaproveitar FC da mesma pessoa feita há menos de:**
   - (a) 30 dias (recomendado)
   - (b) 60 dias
   - (c) 90 dias
   - (d) nunca reaproveitar
9. **Depois dos 90 dias, o "esqueleto" do processo** (imóvel, etapas, datas, id do contrato, sem dados pessoais):
   - (a) fica para histórico e números (recomendado)
   - (b) é apagado também
10. **Limpeza LGPD:**
    - (a) gatilho próprio no fork, sem mexer na função do upstream (recomendado)
    - (b) editar a função LGPD do upstream
11. ~~**Id da pessoa na Superlógica**~~ **RESPONDIDA (28/10, 01:01–01:04):** fica **no contato** do CRM
    (tabela `contato_superlogica_vinculos`, no fork). A pessoa do processo herda o id pelo contato. O casamento
    pelo telefone é a Fase 3.5, com perguntas próprias em [`fase3-5-vinculo-superlogica.md`](fase3-5-vinculo-superlogica.md).
12. **Se um passo precisar ser desfeito em produção:**
    - (a) só desligar a chave e manter as tabelas (recomendado)
    - (b) pode apagar as tabelas novas sem exportar
13. **Quem pode aprovar e reprovar:**
    - (a) aprovar só você; reprovar qualquer atendente com motivo (recomendado)
    - (b) as duas coisas só você
14. **Onde publicar este plano:**
    - (a) adendo no PR #16
    - (b) PR novo só de documentação (sem merge nos dois casos)
