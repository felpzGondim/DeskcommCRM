# Fase 3.5: vínculo contato do CRM ↔ pessoa da Superlógica, pelo telefone (plano para o Felipe validar)

> Só plano. Nada foi criado no banco, no código, no Hub, na VPS ou na Superlógica.
> Escrito em 28/10/2026 (horário de Brasília), a pedido do Felipe (28/10, 01:01–01:04: "Vamos fazer pelo telefone,
> mas não rode a busca de boletos por enquanto" e "Acho que isso pode ser numa fase 3,5").
> Sem dados pessoais: os números nos exemplos são fictícios. Vem **logo depois da Fase 3**
> (`fase3-processo-locacao.md`), que já deixa pronta a tabela `contato_superlogica_vinculos` e o botão manual.

---

## 0. Regras fixas desta fase

- O vínculo mora **no contato** do CRM: cada contato ou número guarda o id da pessoa na Superlógica (`id_pessoa_pes`). O processo de locação herda esse id pelo contato.
- A Superlógica é lida **só pela API**, com GET:
  - nunca pela tela web;
  - nunca com o navegador;
  - nunca encerrando a sessão do Felipe.
- **Nenhuma escrita na Superlógica.**
- **Não roda busca de boletos.** O trabalho de casamento não chama `/cobrancas`, nem a 2ª via, nem o `/consultar` do serviço de boletos. O vínculo serve para usos futuros (boletos e outros), que ficam fora desta fase.
- Antes de gravar qualquer vínculo, roda uma **simulação** que só conta. O Felipe vê os números e aprova.
- Casos ambíguos vão para uma **lista de revisão do Felipe**. Nada ambíguo é ligado sozinho.
- Logs, auditoria e relatórios levam **só contagens e ids internos**. Nunca telefone, nome ou CPF.

---

## 1. O que foi medido (só leitura)

| Item | Resultado |
|---|---|
| Normalização que o Hub já usa | `chave_telefone()` em `/opt/brisa-hub/boleto/boleto.py`. A chave é **DDD + 8 últimos dígitos**: ignora +55, o 0 de longa distância, o código de operadora e o 9º dígito. Recusa DDD inválido e celular de 9 dígitos que não começa com 9. |
| Número sem DDD | `BOLETO_DDD_PADRAO: "11"` no `compose.yml` do Hub ("decisão 5 (18/10): telefone sem DDD no cadastro vale como DDD 11"). |
| Campos de telefone na Superlógica | `st_celular_pes` e `st_telefone_pes`. Um campo pode trazer vários números ("11 9999-0000; 11 3333-4444"), e o Hub já separa por `; , / | e ou`. |
| Endpoints que o Hub já lê | Base `https://apps.superlogica.net/imobiliaria/api`, cabeçalhos `app_token` + `access_token`, só GET, timeout 8 s:<br>• `GET /locatarios` e `GET /proprietarios`: paginados, 100 por página, até 100 páginas (busca de pessoas do plugin)<br>• `GET /contratos?comStatus=ativos&comDadosDosInquilinos=1`: índice de inquilinos ativos do serviço de boletos<br>• `GET /pessoas`: no serviço de contrato |
| Fiadores | O Hub não usa nenhum endpoint de fiadores. Se existir, é preciso confirmar na documentação com uma leitura de teste (passo S2). |
| Limite de chamadas da Superlógica | **Não há limite publicado** (nem nos artigos da Superlógica nem no Hub). O Hub observa cerca de **2 s por página** e guarda cache de 10 min. |
| Contatos da Brisa no CRM (só contagem por formato) | 771 com +55 e 13 dígitos (celular com 9); 44 com +55 e 12 dígitos (fixo ou celular antigo sem o 9); 9 sem telefone. |

---

## 2. Normalização do telefone

O CRM ganha uma função TypeScript `lib/superlogica/telefone.ts` que é **cópia fiel** da `chave_telefone()` do Hub. As duas pontas precisam dar a mesma chave. Uma lista de casos de teste fictícios é compartilhada e roda nos dois repositórios.

Passos:
1. Tira tudo que não é dígito.
2. 12 ou 13 dígitos começando com 55 → tira o 55.
3. Começa com 0 (longa distância, com ou sem operadora) → tira o 0 e a operadora.
4. 10 ou 11 dígitos → DDD = 2 primeiros. Com 8 ou 9 dígitos, sem DDD, usa **DDD 11** (decisão de 18/10).
5. DDD precisa ser de 11 a 99 e sem 0. Com 9 dígitos, o número precisa começar com 9.
6. **Chave = DDD + 8 últimos dígitos.** Assim, "com ou sem o 9" dá a mesma chave.

Exemplos fictícios, todos com chave `11 8765 4321`:
- `+55 11 98765-4321`
- `11 98765-4321`
- `011 8765-4321`
- `8765-4321` (sem DDD → 11)

Além da chave, cada casamento guarda a **qualidade**:

| Qualidade | Quando |
|---|---|
| `exato` | Os dois lados têm DDD e os mesmos 9 dígitos (ou os mesmos 8, se for fixo) |
| `sem_9` | Um lado tem o 9 e o outro não |
| `ddd_presumido` | O lado da Superlógica não tinha DDD e o sistema usou 11 |

O que não entra:
- contatos sem telefone;
- grupos;
- contatos só com identificador do WhatsApp (LID), sem número;
- contatos anonimizados ou já juntados em outro;
- números estrangeiros (sem +55).

---

## 3. Como o trabalho lê a Superlógica

### 3.1 Quem faz o quê

- **Hub (leitura):** um módulo novo e pequeno, `vinculo/`, reaproveita `todas_paginas`, `_get` e `chave_telefone` do Hub.
  - Lê a Superlógica e monta um índice em memória: `chave → [{id_pessoa_pes, tipo, ativo, qualidade}]`.
  - Expõe **uma** rota protegida por Bearer, com permissão nova só de leitura, `vinculo`. A chave de contrato e a de boletos não servem.
- **CRM (decisão e gravação):** o CRM manda ao Hub, em lotes de 200, só `{contact_id, chave}`. O telefone vai já reduzido à chave.
  - O Hub devolve, para cada contato, a lista de pessoas candidatas: ids, tipo, ativo e qualidade. Sem nome, sem CPF.
  - Toda a classificação e toda a gravação acontecem no CRM. O Hub não grava nada e não guarda o resultado.
- Por que assim: os tokens da Superlógica ficam só no Hub, onde já estão, e a escrita fica só no CRM, com RLS e auditoria.

### 3.2 Endpoints da Superlógica (só GET)

| Para quê | Endpoint | Observação |
|---|---|---|
| Locatários | `GET /locatarios` (paginado) | Já usado pelo Hub. Confirmar no S2 se traz ex-inquilinos. |
| Proprietários | `GET /proprietarios` (paginado) | Só se a pergunta 2 incluir |
| Ativo ou ex | `GET /contratos?comStatus=ativos&comDadosDosInquilinos=1` | Marca quem tem contrato ativo hoje. É leitura de contrato, não de boleto. |
| Fiadores | a confirmar (talvez `GET /pessoas` ou os dados do contrato) | Leitura de teste no S2 |

Proibidos nesta fase:
- `/cobrancas`, `/consultar`, a 2ª via de boleto;
- qualquer POST, PUT ou DELETE;
- qualquer tela web.

### 3.3 Cuidado com o volume

Como não há limite publicado, o trabalho é conservador:
- uma chamada por vez, com pausa de 1 s entre páginas;
- 100 itens por página, no máximo 100 páginas por endpoint;
- timeout de 8 s;
- em erro 429, 5xx ou de autenticação: no máximo 2 novas tentativas (espera de 5 s e 30 s). Se ainda falhar, **para tudo** e registra só o código do erro;
- uma execução por vez: uma trava impede duas rodadas ao mesmo tempo;
- o índice vale só durante a execução e é descartado no fim. Nada da Superlógica fica em disco no Hub.

Tempo estimado: cerca de 2 a 3 s por página. Algumas dezenas de páginas levam poucos minutos.

### 3.4 Quando roda

1. **Primeiro, só à mão:** um botão em Configurações, só para admin: "Simular vínculo com a Superlógica".
2. Depois de aprovado, um botão "Rodar valendo".
3. **Agenda opcional** (pergunta 9), só depois de pelo menos uma rodada manual aprovada. Usa o agendador que o CRM já tem e pode ser desligado com uma chave.

---

## 4. Classificação dos resultados

| Categoria | O que é | O que acontece |
|---|---|---|
| `unico_exato` | 1 contato ↔ 1 pessoa, qualidade `exato`, contato sem vínculo | Liga sozinho, **se** a pergunta 1 = (a). Senão, vai para revisão. |
| `unico_parcial` | 1 ↔ 1, mas `sem_9` ou `ddd_presumido` | Revisão (ou liga sozinho, se a pergunta 1 = (c)) |
| `varias_pessoas_um_numero` | Um número com 2+ pessoas na Superlógica (ex.: casal com o mesmo celular) | Revisão: o Felipe escolhe uma ou nenhuma |
| `uma_pessoa_varios_contatos` | A mesma pessoa casa com 2+ contatos (dois números) | Revisão (pergunta 5) |
| `ja_vinculado_igual` | O contato já tem esse mesmo vínculo | Nada |
| `ja_vinculado_diferente` | O contato já tem vínculo com **outra** pessoa | Revisão. **Nunca sobrescreve.** |
| `numero_mudou` | O contato tem vínculo, mas o número atual não casa mais com a pessoa | Revisão (pergunta 7). Nunca desliga sozinho. |
| `sem_casamento` | Nenhuma pessoa com essa chave | Nada (só conta) |
| `fora` | Sem telefone, grupo, LID, estrangeiro, anonimizado | Nada (só conta) |

---

## 5. Simulação antes de gravar

- **Modo simulação:** roda tudo, mas não grava vínculo nem item de revisão. Grava só uma linha de execução com o resumo:
  - quantos contatos foram lidos;
  - quantas pessoas da Superlógica, por tipo e ativo/ex;
  - quantos em cada categoria da seção 4 e em cada qualidade;
  - quantos seriam ligados sozinhos e quantos iriam para revisão;
  - duração, páginas lidas, erros (só códigos).
- O Felipe vê esse quadro numa tela de Configurações. Ninguém recebe mensagem nem e-mail.
- **Modo valendo:** só pode ser disparado pelo Felipe, depois de uma simulação dos últimos 7 dias. Grava os vínculos automáticos (se aprovados) e a lista de revisão. Cada vínculo guarda o `execucao_id`, para dar para desfazer a rodada inteira.

---

## 6. Lista de revisão e botão manual

### 6.1 Lista de revisão (Felipe)

- Fica numa tela em Configurações → Superlógica → Revisão. Mostra, por item:
  - o contato do CRM (nome e número, que já estão no CRM);
  - a categoria e a qualidade;
  - as pessoas candidatas: id e tipo, ativo/ex. O nome da Superlógica é buscado **na hora**, ao abrir o item, por uma rota de leitura do Hub. Ele não é guardado (pergunta 11).
- Ações: **Ligar** (escolhe uma pessoa), **Não ligar**, **Pular**.
- Cada decisão grava quem e quando. Item não decidido expira em 30 dias (pergunta 10).
- Itens recusados não voltam na próxima rodada se nada mudou (mesma chave e mesmas pessoas).

### 6.2 Botão manual (atendente)

O botão vem da Fase 3, no painel do contato e na pessoa do processo:
- **Ligar à Superlógica:** o atendente digita o id ou busca. A busca usa a rota de pessoas do Hub que já existe, por nome, e mostra só id, nome e tipo.
- **Desligar:** com motivo `errado` / `numero_mudou` / `outro`.
- Auditoria: `audit()` com a ação (`contato.superlogica.ligar` / `desligar`), o id do contato e o id da linha de vínculo. **Sem** telefone, nome ou CPF.
- Desligar nunca apaga a linha: marca `ativo = false` com quem e quando.

Quem pode: pergunta 8.

---

## 7. Tabelas (só no fork)

Todas seguem o mesmo padrão da Fase 3:
- `organization_id` e RLS por `fn_user_org_ids()`, com `tenant_isolation_*` e `support_write_*`;
- texto + CHECK;
- **nenhuma função SECURITY DEFINER nova** aberta a usuários.

- `contato_superlogica_vinculos`: **já criada na Fase 3**. A Fase 3.5 só acrescenta `execucao_id uuid null references superlogica_vinculo_execucoes(id) on delete set null` e `qualidade text`.
- **`superlogica_vinculo_execucoes`**
  - `id`, `organization_id`, `modo check (in ('simulacao','valendo'))`
  - `estado check (in ('rodando','concluida','erro','cancelada'))`
  - `iniciado_por`, `iniciado_em`, `terminado_em`
  - `resumo jsonb` (**só contagens**), `erro_codigo text`
  - Índice parcial único: uma execução `rodando` por organização.
- **`superlogica_vinculo_revisoes`**
  - `id`, `organization_id`, `execucao_id`, `contact_id references contacts on delete cascade`
  - `candidatos jsonb`: lista de `{superlogica_pessoa_id, tipo, ativo, qualidade}`, só ids
  - `categoria`, `chave_hash` (hash da chave, para saber se algo mudou; nunca o número)
  - `estado check (in ('pendente','ligado','nao_ligar','expirado'))`, `decidido_por`, `decidido_em`, `expira_em`
  - Índices: `(organization_id, estado)`, `unique (organization_id, contact_id) where estado = 'pendente'`
- Migration: o próximo número livre no dia (`07xx_superlogica_vinculo.sql`), com `-- manifest:` e o apêndice no `baseline.sql`, mais `pnpm checar:colisao-de-migration` e regerar os tipos.
- Desfazer:
  - Desfazer uma rodada = marcar `ativo = false` em todos os vínculos daquela `execucao_id`.
  - Desfazer a fase = chave `organizations.settings.superlogica_vinculo.habilitado` desligada, e então `drop` das 2 tabelas novas e das 2 colunas acrescentadas.
- LGPD:
  - o gatilho da Fase 3 já desliga os vínculos de contato anonimizado;
  - as revisões do contato são apagadas junto (cascade / limpeza);
  - o export LGPD inclui os vínculos do contato.
- Retenção: revisões decididas ou expiradas são apagadas em 30 dias. Execuções ficam (só contagens).

---

## 8. Mudança de número e contatos juntados

- **O número do contato mudou:** o vínculo continua. Na próxima rodada vira `numero_mudou` e vai para a revisão (pergunta 7).
- **O contato foi juntado em outro** (`is_merged_into`):
  - se o contato que fica não tem vínculo, o vínculo passa para ele;
  - se tem um vínculo diferente, vai para revisão;
  - se é igual, nada.
- **Uma pessoa trocou de número na Superlógica:** mesmo tratamento (`numero_mudou`).

---

## 9. Passos pequenos e reversíveis

| Passo | O que entra | O Felipe aprova | Como desfazer |
|---|---|---|---|
| **S0** | Só este documento | Texto e respostas | — |
| **S1** | Hub: módulo `vinculo/` + rota de leitura + testes com respostas falsas (sem chamar a Superlógica real) + casos de teste do telefone | PR no brisa-hub e o deploy do Hub | Reverter o PR; tirar a permissão `vinculo` |
| **S2** | **Primeira leitura real**, só contagens: quantas pessoas por tipo, quantas com telefone, quantas sem DDD; confirmar ex-inquilinos e fiadores. Sem casar nada. | Rodar uma vez | Nada a desfazer (só leitura) |
| **S3** | CRM: migration (execuções e revisões) + função de telefone + botão "Simular" | Aplicar a migration | Chave desligada; `drop` |
| **S4** | **Simulação** na Brisa → quadro de contagens | Olhar os números | Nada foi gravado |
| **S5** | "Rodar valendo": vínculos automáticos (se aprovados) + lista de revisão | Rodar uma vez | Desfazer a rodada pelo `execucao_id` |
| **S6** | Tela de revisão + nome buscado na hora | Uso | Chave desligada |
| **S7** (opcional) | Agenda semanal ou diária | Ligar a agenda | Desligar a agenda |

Testes:
- telefone, com os mesmos casos fictícios no TS e no Python: com e sem 9, com e sem 55, com 0 e operadora, sem DDD → 11, DDD inválido, vários números no mesmo campo;
- classificação de cada categoria;
- nunca sobrescreve vínculo diferente;
- simulação não grava vínculo;
- uma execução por vez;
- isolamento entre 2 organizações (`pnpm test:db`);
- logs e `audit()` sem telefone e sem nome (teste que procura padrões de telefone e CPF na saída);
- o Hub só faz GET e nunca chama `/cobrancas`.

Fora do escopo: busca de boletos, escrita na Superlógica, tela web da Superlógica, casamento por CPF ou por nome, mensagens para clientes.

---

## 10. Perguntas para o Felipe (Fase 3.5)

1. **Ligar sozinho:**
   - (a) só casamentos únicos e exatos; o resto vai para a revisão (recomendado)
   - (b) tudo para a revisão, nada automático
   - (c) únicos exatos e também os "sem o 9"
2. **Quem da Superlógica entra:**
   - (a) locatários e fiadores (recomendado)
   - (b) locatários, fiadores e proprietários
   - (c) só locatários
3. **Ex-inquilinos (sem contrato ativo):**
   - (a) entram, marcados como "ex" (recomendado)
   - (b) só quem tem contrato ativo
4. **Número sem DDD na Superlógica (vale 11):**
   - (a) casa, mas vai para a revisão (recomendado)
   - (b) casa e conta como exato
   - (c) ignorar esses números
5. **Mesma pessoa com 2 números/contatos:**
   - (a) pode ligar os dois, depois da revisão (recomendado)
   - (b) só um contato por pessoa
6. **Um número com várias pessoas (ex.: casal):**
   - (a) revisão, e você escolhe uma ou nenhuma (recomendado)
   - (b) não liga nenhuma, nem mostra
7. **O número do contato mudou:**
   - (a) mantém o vínculo e manda para a revisão na próxima rodada (recomendado)
   - (b) desliga sozinho
   - (c) mantém sem avisar
8. **Quem pode ligar e desligar à mão:**
   - (a) qualquer atendente, com auditoria; a lista de revisão só você (recomendado)
   - (b) só você (ou admin)
9. **Rodar sozinho depois da primeira vez:**
   - (a) não, só à mão (recomendado no começo)
   - (b) uma vez por semana
   - (c) todo dia de madrugada
10. **Item da revisão sem decisão expira em:**
    - (a) 30 dias (recomendado)
    - (b) nunca
11. **Na revisão, mostrar o nome da Superlógica:**
    - (a) sim, buscado na hora e não guardado (recomendado)
    - (b) não, só id e tipo
12. **Se uma rodada sair errada:**
    - (a) desfazer a rodada inteira pelo botão (só você) (recomendado)
    - (b) corrigir um por um
