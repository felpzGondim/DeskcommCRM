# Plano: processo de locação (Inbox → análise → contrato)

**Status:** rascunho — o Felipe já respondeu parte da §8; **ainda não validou o plano inteiro nem autorizou implementar.** Nenhuma linha de produto foi alterada neste PR.
**Âncora medida:** `origin/main` do fork `felpzGondim/DeskcommCRM` em `905b1027c` (tag `v1.88.0-felpz.5`, 27/10/2026).
**Destino (confirmado, Q15):** só este fork. Tabelas novas **não** sobem para `melgarafael/DeskcommCRM`. As peças do painel já existentes continuam como consumidor opcional do servidor MCP externo.

Este arquivo é a trilha para a próxima sessão. Implementação só depois do “pode ir à Fase 1”.

---

## 1. Resumo para o dono (leia isto primeiro)

Hoje o atendente já tem, na coluna direita da conversa (Inbox), um **Painel do agente**. Ele conversa só com quem atende — nunca manda nada para o cliente. Os botões que já existem:

| # | Botão | O que faz hoje | Pronto para usar de verdade? |
|---|---|---|---|
| 1 | Resumir conversa / Sugerir resposta | A IA lê a conversa e ajuda o atendente | Sim, se a IA do painel estiver escolhida em **IA › Provedores** |
| 2 | Buscar boletos | Consulta 2ª via no SuperLógica via Hub | Só se o Hub em produção anunciar a ferramenta |
| 3 | Consultar contrato e inquilino | Lê contrato ativo pelo telefone da conversa | Idem |
| 4 | Ficha cadastral / pedir documentos | Olha **nome e legenda** dos anexos e sugere o que falta | Frágil: não lê o arquivo |
| 5 | Iniciar análise de inquilino | Lê a conversa, monta uma prévia, e só depois pede o Hub | Não lê foto; PDF escaneado falha; conversa longa trava; não guarda nada |
| 6 | Gerar contrato | Formulário manual → prévia → confirmação → cria locação **ATIVA** no SuperLógica | Código no CRM **existe** (PR #8). Nunca foi testado de ponta a ponta. O Hub precisa estar no ar com a permissão certa |
| 7 | Chamado de manutenção | — | **Fora deste plano** (Q11). Não implementar nas Fases 1–5 |

O que dói no dia a dia, na ordem em que vamos tratar:

1. **O contrato ainda não foi testado de verdade.** O botão está na tela, mas criar uma locação de teste no SuperLógica ainda depende de publicar o Hub e autorizar a chave do CRM. Sem isso, o resto é casa sem alicerce.
2. **A análise não lê o que o cliente manda.** Foto de RG ou holerite entra como “imagem sem leitura”. PDF escaneado (sem texto selecionável) é pulado. PDF com senha falha em silêncio. Se a conversa passa de 200 mensagens, o botão recusa. Os arquivos **não vão** para o serviço que consulta FC Score+ e Migra.
3. **Nada fica gravado entre uma etapa e outra.** O atendente analisa, fecha a conversa, e na hora de gerar o contrato digita tudo de novo.
4. **O CRM não sabe quem é essa pessoa no SuperLógica.** Cada consulta recomeça pelo telefone.

O que este plano constrói, em fases que dá para parar e validar:

| Fase | O que o atendente ganha | Quem implementa |
|---|---|---|
| **1 — Ligar o que já existe** | Gerar um contrato de *teste* de ponta a ponta, com checklist | Felipe + Hub (outro bot) + verificação no CRM |
| **2 — Ler os anexos** | Foto, PDF escaneado e PDF com senha entram na análise; conversa longa não trava | Este repo (CRM) + Hub/analise (arquivos no job) |
| **3 — Processo de locação** | Uma ficha por imóvel, com N participantes (locatário/fiador/solidário) e o WhatsApp só como interlocutor; reaproveitada no contrato | Este repo (banco + API + tela) |
| **3b — Documentos organizados** | Pasta por processo no Storage; ao fechar contrato, arquivo no Drive da Brisa; o que não vira contrato some em 90 dias | Este repo (Storage + poda) + **n8n na VPS** (Drive e backup) |
| **4 — Painel de análise** | Quatro botões: Analisar renda, Analisar FC, Analisar seguro-fiança, Gerar relatório. Pré-preenchidos, editáveis, com andamento do job | Este repo (tela) + Hub (jobs e confirmação cobrada) |
| **5 — Contrato pré-preenchido** | Gerar contrato **sempre disponível** (formulário vazio continua); se houver processo, pré-preenche. Aprovação do Felipe é manual e obrigatória. No sucesso, grava os IDs | Este repo + Hub (já cria a locação) |

**Regras que não mudam em fase nenhuma:**

- SuperLógica é a verdade. O CRM **não copia** contrato, boleto nem cadastro — só guarda um número de ligação (`id_pessoa_pes`, `id_contrato`) e o que o atendente conferiu neste processo.
- Toda escrita no SuperLógica e toda mensagem ao cliente exigem **clique explícito** do atendente. A IA nunca envia e nunca grava locação sozinha.
- **Aprovação do processo é só do Felipe**, à mão, mesmo se renda/FC/seguro/relatório tiverem “ok”. Análise nenhuma aprova nem cria contrato.
- **Gerar contrato nunca some.** Sem processo, o formulário vazio de hoje segue válido. Com processo, só pré-preenche.
- Tudo versionado, com documento de decisão, para outra IA continuar sem adivinhar.

**O que ainda falta para implementar:** as perguntas 1 e 2 da §8 (URL do Hub / PR #22) estão em verificação à parte; o restante da §8 ainda aberto; e o “pode ir à Fase 1”.

---

## 2. Diagnóstico do estado atual (medido neste clone)

Convenção: **CONFIRMADO** = visto no código desta `main`. **INFERIDO** = lido em decisão/evidência, sem o repositório do Hub aberto. **NÃO MEDIDO** = este ambiente não alcançou.

### 2.1 O que já entrou no fork

| PR | O que entrou | Tag |
|---|---|---|
| #5 | Painel do atendente (resumir / sugerir / pergunta livre) | `v1.88.0-felpz.3` |
| #6 + #7 | Botões do Hub (boletos, contrato, ficha, análise) e correção de CI | `v1.88.0-felpz.4` |
| #8 | **Gerar contrato** (formulário, rota, testes, evidência de UI) | junto da `felpz.5` |
| #9 | Notas da revisão `felpz.5` | `v1.88.0-felpz.5` |

Decisões já escritas: [`docs/decisoes/painel-agente.md`](../decisoes/painel-agente.md) e [`docs/decisoes/painel-acoes-hub.md`](../decisoes/painel-acoes-hub.md). Mapa: [`docs/architecture/painel-acoes-hub.architecture.json`](../architecture/painel-acoes-hub.architecture.json).

### 2.2 Arquivos que importam (CRM)

| Peça | Arquivo |
|---|---|
| Tela do painel | `components/inbox/PainelDoAgente.tsx` |
| Formulário de contrato | `components/inbox/GerarContratoDialog.tsx` |
| Rota de texto (resumir/sugerir) | `app/api/v1/conversations/[id]/painel-agente/route.ts` |
| Rota das ações do Hub | `app/api/v1/conversations/[id]/painel-agente/acoes/route.ts` |
| Rota de contrato | `app/api/v1/conversations/[id]/painel-agente/contrato/route.ts` |
| Contrato com o Hub (nomes das ferramentas) | `lib/agent-engine/agent/painel-acoes-hub.ts` |
| Prévia da análise (PDF, hash, token) | `lib/agent-engine/agent/painel-analise-preparo.ts` |
| Prompt da prévia (só texto) | `lib/agent-engine/agent/painel-do-atendente.ts` → `prepararAnaliseNoPainel` |
| Transporte HTTP do contrato | `lib/agent-engine/agent/painel-contrato.ts` → `chamarApiContrato` |
| Cadastro do Hub | Configurações → Servidor MCP externo (`app/app/settings/servidor-mcp-externo/`) |
| Derivação universal de mídia (visão/Whisper/PDF) | `workers/media-derive-worker.ts`, `lib/messaging/media/derive.ts` |
| Extração de PDF (sem OCR) | `lib/ai/rag/extractors/pdf.ts` |

### 2.3 Gerar contrato — o que o código faz, e o que falta na VPS

CONFIRMADO no CRM:

- O botão abre um diálogo. O atendente preenche imóvel, locatários (CPF obrigatório), fiadores, aluguel, datas, reajuste, garantia, taxas e despesas.
- **Preparar** chama `POST /api/v1/conversations/:id/painel-agente/contrato` com `etapa: "preparar"`. A rota é `agent+`, bloqueia suporte só leitura, resolve conversa/contato pela organização da sessão (nunca do body).
- O CRM **não fala SuperLógica**. Ele pega o endereço do MCP cadastrado (`…/mcp`) e troca o sufixo: `…/contrato/preparar` e `…/contrato/confirmar`. A mesma chave Bearer do MCP vai no header.
- Só uma prévia **pronta e sem pendências** ganha token assinado (HMAC, preso a org + conversa + usuário + hash do servidor, no máximo 30 min).
- **Confirmar** exige checkbox + `confirmado: true`. A mesma prévia sempre manda a mesma `idempotency_key` ao Hub (retomar depois de timeout não cria locação duplicada).
- Resultado mostra `id_contrato`, situação, despesas pendentes e ações manuais. **Não gera PDF. Não manda WhatsApp.**
- Auditoria: `ai.painel_atendente.contrato_preparado` / `contrato_confirmado` — sem CPF, sem resumo.
- Testes unitários cobrem rota, token, diálogo e coexistência com “Sugerir resposta”. Evidência visual em `evidence/gerar-contrato-painel/` é **UI com Hub simulado**, não SuperLógica real. O próprio README da evidência declara: *“Não medido: criação real no SuperLógica, credencial de produção, deploy do Hub.”*

INFERIDO no Hub (lido na decisão e na evidência do PR #8; o repositório `felpzGondim/brisa-hub` devolveu **404** para este ambiente):

- API Python em `contrato/contrato.py` (commit citado na evidência: `628b430`).
- Fluxo `preparar → confirmar`: cria locatários, contrato **ATIVO**, despesas de IPTU e seguro fiança no SuperLógica.
- A chave do CRM precisa estar em `CONTRATO_KEYS_SHA256`.
- O proxy `BRISA_HUB_CONTRATO_URL` aponta para o serviço interno de contrato.
- O PR `felpzGondim/brisa-hub#22` é o que anuncia as ferramentas de contrato/ficha/análise no MCP. Em 26/10/2026 o teste de conexão do CRM via só `status` e `segunda_via_boleto`.

A derivação `…/mcp` → `…/contrato/{etapa}` é frágil: qualquer MCP que **não** termine em `/mcp` estoura `hub_endpoint_invalid`; um proxy que sirva MCP e contrato em hosts diferentes também quebra. Isso é conserto da Fase 1 (pergunta 8.1).

### 2.4 Análise e anexos — o que o código realmente faz

CONFIRMADO em `painel-analise-preparo.ts` e na rota `acoes`:

1. A rota pede até **201** mensagens. Se vierem mais de 200, devolve 422: *“Esta conversa é extensa demais…”*. Não há janela relevante — é bloqueio duro.
2. `lerPdfsOriginais` reabre no máximo **8** PDFs do bucket `whatsapp-media`, só se o caminho for `{org}/{conversa}/…`, MIME `application/pdf`, até 10 MB. Texto extraído acima de 40 mil caracteres **por arquivo** ou 60 mil no conjunto é **pulado em silêncio** (`continue`). Exceção (PDF corrompido, senha, escaneado) também é silêncio.
3. `extractPdfText` (`pdfjs-dist`) só lê letra selecionável. PDF escaneado sai com motivo `sem_texto`. **Não há OCR em lugar nenhum do CRM.**
4. Imagens **nunca** são fonte legível da análise. O código usa só a legenda (`body`) e o comentário diz: *“Descrição de imagem não é OCR financeiro”*. O teste `PDF truncado ou imagem descritiva exige leitura original` **trava de propósito** se a visão do worker tiver descrito a foto. Ou seja: o `media-derive-worker` já sabe descrever imagem (ponto `visao_de_imagem`), mas a análise **joga essa descrição fora** e ainda marca o anexo como pendência.
5. A expressão exata `body ?? media_derived_text` **não aparece** no caminho da análise. O efeito prático é o mesmo, e pior: em imagem o derivado é ignorado mesmo quando existe; em documento, o derivado só vale se `lerPdfsOriginais` marcou `original_completo`. Uma foto de holerite com legenda “holerite” (ou legenda vazia) **não entra no JSON da prévia**.
6. A ficha (`montarFichaTemporaria`) manda ao Hub só `{ nome, mime, legenda }` das últimas 60 mensagens, até 30 anexos. Sem caminho, sem bytes, sem texto extraído. O Hub classifica por nome/legenda.
7. `prepararAnaliseNoPainel` recebe um bloco de texto. Sem imagem, sem PDF em binário.
8. O `tools/call` de `iniciar_analise_inquilino` manda JSON (`pedido_id`, `conversa_id`, `organization_id`, `candidato`, `imovel`, `renda`). **Nenhum arquivo.** O Hub/analise não recebe o PDF nem a foto.

Há uma camada universal que **já lê** áudio (Whisper), imagem (visão) e PDF com texto (`media-derive-worker`), gravando em `messages.media_derived_text` com teto de **8 mil caracteres**. A análise desconfia desse teto para PDF (por isso reabre o original) e, para imagem, desconfia da visão (porque “parece um extrato” não prova valor). Os dois recuos são razoáveis. O buraco é: **não há um segundo passo que leia a foto como documento e o PDF escaneado com OCR**, nem um jeito de o atendente informar a senha.

### 2.5 Persistência e SuperLógica

CONFIRMADO:

- Não existe tabela de processo de locação. A prévia da análise vive num token de 30 minutos. O formulário de contrato vive no estado do React (fecha o diálogo e o texto some da tela; os campos do form sobrevivem enquanto o componente existir).
- `contacts` já tem `person_id` → `people` (cadastro interno empresa/pessoa da importação). **Não é** o `id_pessoa_pes` do SuperLógica.
- `contacts` já tem `cpf_encrypted` / `cpf_hash` (CPF do CRM, criptografado). Continua sendo o CPF da conversa, não o vínculo com o ERP.
- Não há `superlogica_pessoa_id` (nem nome parecido) em contato, lead ou conversa.

### 2.6 Brisa Hub — o que este ambiente conseguiu ver

O repositório `https://github.com/felpzGondim/brisa-hub` respondeu **404** (privado ou sem permissão deste token). Portanto o plano **não afirma** o estado de deploy, o conteúdo do PR #22, nem o contrato da API de jobs além do que as decisões do CRM já escreveram.

O que o CRM **exige** do Hub (contrato em `painel-acoes-hub.ts` + `painel-contrato.ts`):

| Superfície | Quem chama | O que o Hub precisa ter |
|---|---|---|
| MCP `tools/list` + `tools/call` | CRM, com Bearer do cadastro | `segunda_via_boleto`, `consultar_contrato_inquilino` (ou o par `buscar_contrato`+`buscar_inquilino`), `buscar_cadastro`/`buscar_ficha_cadastral`, `iniciar_analise_inquilino` (ou aliases) |
| HTTP `POST /contrato/preparar` e `/contrato/confirmar` | CRM, mesma origem e Bearer do MCP | Aceitar a chave em `CONTRATO_KEYS_SHA256`; proxy `BRISA_HUB_CONTRATO_URL` |
| Serviço `brisa-analise` | Hub, não o CRM | Playwright (FC Score+ e Migra), lock antes do passo pago, job persistente, `iniciar_analise_inquilino` |
| Consulta de andamento do job | **ainda não existe no CRM** | Precisa nas Fases 4 (e, se der, já na 1 para não voar às cegas) |

### 2.7 Botão 7 (chamado de manutenção)

Não há ferramenta, rota nem botão. **Fora deste plano** (Q11, 27/10/2026). Não desenhar, não reservar fase, não abrir issue daqui.

---

## 3. Arquitetura alvo

```
                    Inbox (Painel do agente)
                    ┌─────────────────────────────────────────┐
                    │ Resumir / Sugerir                       │
                    │ Boletos / Consultar contrato            │
                    │ Ficha  →  Análise (4 botões)            │
                    │ Gerar contrato (pré-preenchido)         │
                    └───────────┬─────────────────────────────┘
                                │ cookie de sessão; org da sessão
                    CRM (este repo)
                    ┌───────────┴─────────────────────────────┐
                    │ processo + N participantes (Postgres)   │
                    │ documentos (Storage privado)            │
                    │ link SuperLógica no participante        │
                    │ (atalho opcional no contato)            │
                    │ MCP externo + HTTP /contrato            │
                    └─────┬───────────────────┬───────────────┘
                          │                   │ evento "contrato criado"
                    brisa-hub (VPS)           n8n (VPS)
                    ┌─────┴────────┐          ┌┴─────────────────────┐
                    │ MCP          │          │ Copia pasta do        │
                    │ /contrato    │          │ processo → Drive da   │
                    │ brisa-analise│          │ Brisa + backup local  │
                    └──────┬───────┘          └──────────────────────┘
                           │ só API, sob demanda
                      SuperLógica (fonte da verdade)
```

Papéis, sem ambiguidade:

| Camada | Dono | Pode | Não pode |
|---|---|---|---|
| **DeskcommCRM (este repo)** | Painel, processo, Storage, link de ID, confirmação humana, auditoria, poda LGPD | Ler conversa e anexos; guardar o que o atendente conferiu; chamar Hub; mostrar andamento | Copiar cadastro/contrato do SuperLógica; escrever no SuperLógica direto; enviar WhatsApp sozinho; falar com Drive |
| **brisa-hub (outro bot)** | MCP, API de contrato, jobs de análise, lock do passo pago, Playwright (FC/Migra) | Traduzir pedido confirmado em chamada SuperLógica; devolver structuredContent e status de job | Confiar em body do CRM para `organization_id`; executar passo pago sem confirmação; guardar cópia permanente do ERP |
| **n8n na VPS** | Arquivamento e backup | Ao receber “contrato criado”, copiar a pasta do Storage para o Drive (uma pasta por imóvel/contrato) e para disco local | Decidir se o contrato existe; apagar processo ainda aberto; escrever no SuperLógica |
| **SuperLógica** | Pessoas, contratos, boletos, despesas | Fonte da verdade | — |

Fluxo feliz depois das cinco fases:

1. Cliente manda documentos no WhatsApp. O CRM classifica e guarda no processo (Fase 3b).
2. Atendente abre **Análise da ficha** (Fase 4). A IA pré-preenche renda / FC / seguro a partir da conversa **e** dos arquivos. Atendente edita e salva.
3. Passos pagos (FC Score+, eventualmente outros) pedem um segundo clique. O painel mostra o andamento do job no Hub.
4. Relatório agrupado é conferido e salvo. Isso **não** aprova o processo.
5. O Felipe aprova à mão (status `aprovado`), quando quiser. Sem essa marca o contrato ainda pode ser gerado — a aprovação não é trava do botão.
6. **Gerar contrato** está sempre no painel. Se existe processo, pré-preenche locatários/fiadores/solidários e o imóvel; se não existe, o formulário vazio de hoje. Atendente (ou o Felipe) confere a prévia do Hub e confirma. SuperLógica cria a locação ATIVA. Nada disso roda sozinho.
7. CRM grava `id_contrato` no processo e `superlogica_pessoa_id` em **cada participante** que o Hub devolver. Se o interlocutor do WhatsApp também for participante, o atalho no `contacts` pode receber o mesmo id. Emite evento. n8n arquiva. Processo que **não** virou contrato some após 90 dias.

Laço de retorno (Sistema Vivo, invariante 7): se a criação falhar, a mesma prévia retoma o mesmo pedido (já existe). Se a análise cobrada falhar, o job do Hub fica visível no painel e o processo não avança de status. Se o n8n falhar o arquivo, o processo **não** é podado (status `contrato_criado` + `arquivo_drive` pendente) e a Central ganha um aviso.

---

## 4. Modelo de dados (Fase 3 / 3b — não criar agora)

Nada disto entra antes da Fase 1 estar verde na VPS. A numeração `NNNN` livre na `main` deste fork, hoje, é **0762** em diante — na hora de implementar, rodar `pnpm checar:colisao-de-migration` de novo. Tripla obrigatória: arquivo em `supabase/migrations/` com `-- manifest:` + apêndice idempotente no `supabase/baseline.sql`. **Não** editar `MANIFEST.md`.

### 4.1 Quem é quem (decisão Q3, 27/10/2026)

Cada pessoa física é **uma** pessoa no SuperLógica. Casal compartilhando o mesmo WhatsApp **não é o caso comum**. O caso comum que o modelo tem de aguentar é outro: **quem fala no WhatsApp não é necessariamente quem entra no contrato** (filha conversa; pai ou mãe é o locatário).

Por isso o processo tem dois papéis distintos:

| Papel no CRM | O que é | Precisa ser contato? | Precisa ter `id_pessoa_pes`? |
|---|---|---|---|
| **Interlocutor** | Quem está na conversa do Inbox | Sim — é o `contacts` da conversa | Só se essa pessoa também for participante do contrato |
| **Participante** | Quem entra (ou pode entrar) no contrato: locatário, fiador, solidário | Opcional | Opcional até o Hub devolver o id |

Não basta um `superlogica_pessoa_id` no contato da conversa: o interlocutor pode **não** ser locatário. A fonte da verdade dos vínculos é a tabela de participantes (§4.3). A coluna no contato (§4.2) fica só como **atalho** quando o interlocutor também é participante e já tem id.

### 4.2 Atalho no contato (não substitui o participante)

```sql
-- em public.contacts
alter table public.contacts
  add column if not exists superlogica_pessoa_id text;

comment on column public.contacts.superlogica_pessoa_id is
  'Atalho: id_pessoa_pes deste interlocutor quando ELE também é pessoa no SuperLógica. O cadastro mora no ERP; o contrato lista N pessoas em locacao_processo_participantes.';
```

Índice: `(organization_id, superlogica_pessoa_id)` onde o valor não é nulo. Unique **por organização** (um `id_pessoa_pes` ↔ um contato), porque uma pessoa = uma linha no SuperLógica e casal no mesmo número não é o fluxo. Quem não é o interlocutor **não** ganha linha em `contacts` só para guardar o id — mora no participante.

LGPD: a cascata zera esta coluna no mesmo passo que zera `cpf_encrypted`. O export do titular inclui o id. Anonimizar o interlocutor **não** apaga o processo se ainda houver outros participantes: redige o atalho e o `interlocutor_contact_id` vira nulo / marca anonimizada; os outros participantes seguem até a poda ou a anonimização deles. Detalhe na hora da migration (não inventar agora).

Não gravar nome, CPF, endereço nem contrato do SuperLógica nesta coluna.

### 4.3 Entidade `locacao_processos` + participantes

Uma linha de processo = **um interlocutor (conversa) + um imóvel**. As pessoas do contrato são linhas filhas.

```text
public.locacao_processos
  id                         uuid pk
  organization_id            uuid not null → organizations on delete cascade
  interlocutor_contact_id    uuid not null → contacts on delete restrict
  conversation_id            uuid null → conversations on delete set null

  -- imóvel (chave de negócio; SuperLógica continua a fonte)
  imovel_codigo_fc           text null
  imovel_endereco            text null          -- o que o atendente conferiu
  imovel_identidade          text not null      -- canônico: codigo_fc ou endereço normalizado
                                                -- unique (organization_id, interlocutor_contact_id, imovel_identidade)

  status                     text not null      -- ver vocabulário abaixo
  -- dados conferidos (não são o ERP)
  renda                      jsonb not null default '{}'
  resultado_fc               jsonb not null default '{}'
  cotacao_seguro             jsonb not null default '{}'
  relatorio                  jsonb not null default '{}'

  superlogica_contrato_id    text null          -- só o link, depois da Fase 5
  arquivo_drive_url          text null          -- preenchido pelo n8n
  arquivo_vps_path           text null

  -- aprovação do Felipe: só ele (ou quem ele delegar na tela).
  -- Nenhum passo de análise escreve estes campos.
  aprovado_por               uuid null → auth.users
  aprovado_em                timestamptz null
  created_by                 uuid null → auth.users
  created_at                 timestamptz not null default now()
  updated_at                 timestamptz not null default now()

public.locacao_processo_participantes
  id                         uuid pk
  organization_id            uuid not null → organizations on delete cascade
  processo_id                uuid not null → locacao_processos on delete cascade
  papel                      text not null  -- locatario | fiador | solidario
  contact_id                 uuid null → contacts on delete set null
  superlogica_pessoa_id      text null      -- id_pessoa_pes; só o link
  nome                       text null      -- o que o atendente conferiu
  email                      text null
  cpf_mascarado              text null      -- nunca o CPF completo em claro
  created_at                 timestamptz not null default now()
  updated_at                 timestamptz not null default now()
  -- um processo não lista a mesma pessoa duas vezes no mesmo papel
  unique (processo_id, papel, superlogica_pessoa_id) where superlogica_pessoa_id is not null
```

O interlocutor **não** entra sozinho como locatário. Se a filha fala e o pai aluga, o processo aponta para o contato da filha e o pai é um participante `locatario` sem `contact_id` (até alguém ligar). Se a própria interlocutora também for locatária, aí sim há uma linha de participante com o `contact_id` dela.

Vocabulário de `status` (text + CHECK, doutrina do repo):

`rascunho` → `documentos` → `renda_conferida` → `fc_pendente` → `fc_pronta` → `seguro_pendente` → `seguro_pronto` → `relatorio_pronto` → `aprovado` → `contrato_criado` → `arquivado`  
Saídas laterais: `recusado`, `expirado` (poda).

`aprovado` **só** muda quando o Felipe (usuário humano) confirma na tela. Terminar renda/FC/seguro/relatório **não** avança para `aprovado`. `Gerar contrato` **não** exige `aprovado` (Q10).

CPF completo **não** mora em claro. Se o contrato precisar do CPF de um participante sem contato, o atendente confirma na prévia do Hub. Guardar CPF cifrado no participante é a pergunta 8.4 (ainda aberta).

DIRC, para não nascer coluna morta:

| Dado | Decisão |
|---|---|
| Quem fala no WhatsApp | Referência: `interlocutor_contact_id` → `contacts` |
| Quem entra no contrato | Tabela `locacao_processo_participantes` (N linhas) |
| Cadastro SuperLógica da pessoa | Referência: `participantes.superlogica_pessoa_id` (+ atalho no contato se for o interlocutor) |
| Contrato no ERP | Referência: `superlogica_contrato_id` |
| Boletos, situação do contrato | Calcular: consultar o Hub na hora |
| Renda / FC / seguro / relatório | Duplicar **o conferido**, com `fonte` e `trecho` |
| Bytes do RG | Referência: caminho no Storage |

### 4.4 Documentos do processo

Espelha o padrão já aceito de `crm_lead_attachments` (migration 0731): linha no banco + binário no Storage, caminho imutável, check no próprio path.

```text
public.locacao_processo_documentos
  id, organization_id, processo_id
  categoria          text not null
                     -- identidade | renda | fc | seguro | relatorio | outro
  origem             text not null  -- conversa | upload_atendente | hub
  message_id         uuid null → messages
  file_name, mime_type, file_size
  storage_path       text not null  -- ver §4.5
  classificacao_ia   jsonb          -- { categoria, confianca, modelo, em }
  conferido_por      uuid null
  conferido_em       timestamptz null
  created_at
```

CHECK de caminho (como 0731), para o `service_role` não gravar path de outra org:

```text
{organization_id}/processos/{processo_id}/{categoria}/{documento_id}.{ext}
```

O briefing pediu `processos/<imovel>/<candidato>/…`. Isso é instável (endereço muda, nome tem acento, casal). O path canônico usa **UUIDs**. A tela e o n8n resolvem o rótulo humano (imóvel, nome) na hora de montar a pasta do Drive.

### 4.5 Storage

Bucket **novo e privado** `locacao-processos` — não misturar com `whatsapp-media` (retenção de mídia do canal é outro relógio e outro propósito) nem com `internal-media` (notas e anexos de negócio).

| Régua | Valor |
|---|---|
| Público | não |
| Teto | 20 MB por arquivo (o WhatsApp já limita; PDF de laudo cabe) |
| MIME | `application/pdf`, `image/jpeg`, `image/png`, `image/webp` |
| Path | `{org_id}/processos/{processo_id}/{categoria}/{id}.{ext}` |
| Policy | **nenhuma para `authenticated`**, igual `whatsapp-media` e `internal-media`: só service role via rota; URL assinada sob demanda |
| Cópia | o arquivo original da conversa **permanece** em `whatsapp-media`. O processo guarda uma **cópia classificada** (ou um ponteiro + cópia no arquivamento). Ponteiro só (`message_id`) morre quando a retenção de mídia do canal apagar o original — por isso a cópia no bucket do processo é a que o Drive vai levar |

Cópia, não movimento: apagar de `whatsapp-media` não pode sumir com a prova do processo.

### 4.6 RLS, auditoria, retenção, LGPD

- RLS: `tenant_isolation_locacao_processos_all`, a dos participantes e a dos documentos, via `fn_user_org_ids()`. Leitura `agent+`; escrita `agent+` nas rotas, com `requireSupportWrite` antes do efeito. Aprovação (`aprovado_por` / `aprovado_em`) é mutação explícita — não sai de job nem de passo de análise.
- Handler com admin client **filtra `organization_id` da sessão**, nunca do body.
- Mutação bem-sucedida → `audit()` (`locacao.processo_criado`, `locacao.analise_salva`, `locacao.contrato_vinculado`, `locacao.arquivado`, `locacao.expurgado`). Sem CPF, sem bytes, sem resumo da ficha.
- Poda: função `fn_expurgar_processos_de_locacao_vencidos` (`security definer`, **piso de 90 dias no corpo**, `revoke` de `public` e `anon`). Apaga só status `rascunho` / `documentos` / `recusado` / `expirado` **sem** `superlogica_contrato_id`. Enfileira os paths do Storage. Chamada em lotes pelo cron `data-retention` (padrão das irmãs em `lib/retencao/politica.ts`). Processo `contrato_criado` sem `arquivo_drive_url` **não** é podado — o n8n ainda deve.
- Cascata LGPD: incluir processo, participantes e documentos + os objetos do bucket em `fn_lgpd_cascade_redact_contact` e no export. Anonimizar o **interlocutor** zera o atalho em `contacts` e redige a linha dele se for participante; os outros participantes não somem só porque quem falava no WhatsApp pediu exclusão — cada pessoa é um titular. Nomes viram `Cliente Anonimizado #N`; arquivos da pessoa saem do Storage.
- Invariante de isolamento (2 orgs) é obrigatório no `pnpm test:db` antes do merge da Fase 3.

### 4.7 O que deliberadamente **não** entra no banco

- Espelho de contratos, boletos, unidades ou pessoas do SuperLógica.
- Texto completo da conversa (a conversa já existe).
- Histórico do painel (decisão vigente: painel é efêmero; o processo é o que sobrevive).
- Chave do Hub, cookie do Playwright, senha de PDF (a senha vive só na sessão do diálogo, o tempo de abrir o arquivo).

---

## 5. Fases — tarefas por repositório, aceite e teste

### Fase 1 — Ligar e testar o Gerar contrato que já existe

**Objetivo:** uma locação de *teste* nasce no SuperLógica a partir do botão da Inbox, com o atendente vendo a prévia e confirmando.

Nenhum schema novo. No CRM, só o mínimo se a derivação de URL falhar na prática (pergunta 8.1).

#### 1.A — Felipe (operação, não código)

Checklist, na ordem. Cada passo tem um “pronto quando”:

1. **Hub no ar com o PR #22 (ou o sucessor que anuncie contrato + ficha + análise).**  
   Pronto quando: em Configurações → Servidor MCP externo → Testar conexão, a lista **não** for só `status` e `segunda_via_boleto`. Têm de aparecer as ferramentas da tabela da §2.6.
2. **`CONTRATO_KEYS_SHA256` no Hub contém o SHA-256 da chave Bearer que o CRM tem cadastrada.**  
   Pronto quando: “Preparar locação” **não** devolve a frase *“A chave do CRM não está autorizada na API de contratos…”*.
3. **`BRISA_HUB_CONTRATO_URL` no Hub aponta para o serviço interno de contrato.**  
   Pronto quando: o MCP em `https://…/mcp` e o HTTP `https://…/contrato/preparar` respondem no **mesmo host** que o CRM deriva, **ou** o Felipe autoriza a URL explícita no CRM (8.1).
4. **Imóvel e conta de teste no SuperLógica** (não um contrato de cliente real). Endereço, dia de vencimento e conta de repasse que o Hub exige na prévia.
5. **Pessoa de teste** (CPF válido de homologação, e-mail e celular que possam ser criados sem misturar com inquilino real).
6. No CRM, abrir a conversa de teste → Painel → **Gerar contrato** → preencher → **Preparar locação** → ler o resumo **inteiro** (taxas, IPTU, seguro, situação ATIVO) → marcar o checkbox → **Confirmar**.
7. Conferir no SuperLógica: contrato ATIVO, locatário criado, despesas IPTU/seguro se pedidas. Anotar `id_contrato` e `id_pessoa_pes`.
8. Repetir o **mesmo** confirmar (simular timeout): o Hub devolve o mesmo contrato, não um segundo.
9. Abrir uma conversa de **outro** telefone e confirmar que a prévia da primeira não cola (409).

#### 1.B — brisa-hub (outro bot)

- Publicar o PR #22 (ferramentas + API `/contrato/*` + `CONTRATO_KEYS_SHA256` + proxy).
- Documentar no README do Hub: variáveis, formato do hash, URL que o CRM vai derivar, payload de `preparar`/`confirmar` (o CRM já valida em `dadosContratoSchema` / `preparoContratoSchema` / `resultadoContratoSchema`).
- Devolver `id_pessoa_pes` no resultado de `confirmar` (hoje o CRM só exige `id_contrato` quando `gravado=true`). Sem o id da pessoa, a Fase 5 não tem o que gravar no contato. Se o OpenAPI atual já devolve, só documentar; se não, é mudança do Hub.
- Endpoint de **andamento do job** de análise (`GET` por `pedido_id`), mesmo que a tela da Fase 4 ainda não exista — senão a Fase 1 de análise (passo abaixo) fica cega.

#### 1.C — DeskcommCRM (este repo, só se a 8.1 pedir)

- Se a URL derivada quebrar: campo opcional no cadastro MCP, *“URL da API de contratos”*, default = derivação atual. Sem isso, não mexer.
- Guardar no resultado da tela (sem persistir) o `id_pessoa_pes` se o Hub já mandar — só para o Felipe anotar no teste. Persistência é Fase 5.

#### Aceite da Fase 1

- [ ] Uma locação de teste ATIVA existe no SuperLógica, criada pelo botão, com prévia lida e checkbox marcado.
- [ ] Segunda confirmação da mesma prévia não duplica.
- [ ] Prévia de outra conversa/org é recusada.
- [ ] Nada foi enviado ao WhatsApp do “cliente”.
- [ ] Auditoria tem as duas ações, sem CPF.
- [ ] Lista escrita (este checklist, preenchida) anexada no PR de implementação ou neste arquivo, seção “Evidência da Fase 1”.

#### Teste da Fase 1

- CRM: os unitários do PR #8 já existem — não reescrever. Rodar `pnpm vitest run tests/unit/painel-contrato.test.ts tests/unit/painel-contrato-rota.test.ts tests/unit/gerar-contrato-dialog.test.tsx`.
- VPS: o checklist 1.A é a prova. Playwright contra SuperLógica real **não** entra no CI (é efeito externo pago/irreversível). Evidência: prints do diálogo + tela do SuperLógica com o id de teste, em `evidence/contrato-e2e-homolog/`.

---

### Fase 2 — Ler todos os anexos

**Objetivo:** a prévia da análise enxerga foto, PDF com texto, PDF escaneado e PDF com senha (esta, pedida ao atendente). Conversa longa não bloqueia. O Hub/analise recebe os arquivos do pedido confirmado.

#### 2.A — DeskcommCRM

1. **Bug da fonte (imagem / derivado).** Em `fontesDaAnalise`, imagem deixa de ser “só a legenda”. Nova regra:
   - texto da mensagem (legenda) e texto derivado **coexistem**, como `corpoDaMensagem` já faz no restante do agente;
   - imagem só é `legivel` quando o derivado veio de um passo **documental** (OCR/visão com prompt de documento), não da descrição curta do worker (“parece um extrato”);
   - o teste atual que *exige* imagem ilegível vira o contrário para o novo passo, e continua valendo para a descrição genérica do worker.
2. **Visão documental (foto de RG, holerite, comprovante).** Reusar o ponto `visao_de_imagem` (ou um ponto novo `painel_documento`, para o orçamento aparecer separado). Prompt: extrair texto e campos, não descrever a cena. Guardar o texto no processo depois da Fase 3; até lá, só na prévia efêmera.
3. **OCR de PDF `sem_texto`.** Quando `extractPdfText` devolver `sem_texto`, rasterizar páginas (teto: N páginas / N MB — pergunta 8.5) e passar pelo mesmo ponto de visão. Sem inventar engine nova se a visão do Gemini da Brisa resolver. Se não resolver, o Hub pode OCR — mas a prévia do CRM precisa do texto **antes** de confirmar o job.
4. **PDF com senha.** `lerPdfsOriginais` hoje engole o erro. Passar a devolver pendência nomeada (`pdf_protegido`) com o nome do arquivo. A UI do painel pede a senha, reenvia **só nessa sessão** (não grava), e tenta de novo. Três falhas = pendência permanente daquele arquivo.
5. **Janela relevante no lugar do bloqueio de 200.** Tirar o `limit(201)` + 422. Usar as últimas N mensagens **com anexo ou com número/CPF/endereço**, mais um teto duro de caracteres do bloco (já existe 60 mil). Número N: proposta 80 mensagens “úteis” ou 400 no bruto — pergunta 8.6.
6. **Passar arquivos ao Hub na confirmação.** Depois da prévia conferida, o CRM manda ao `iniciar_analise_inquilino` (ou a um campo novo acordado) URLs **assinadas, de curta duração, só dos anexos que o atendente marcou**. Sem path interno. O Hub baixa na hora; a URL morre. Alternativa (se o Hub não puder sair na internet até o Storage): o CRM manda multipart para um endpoint novo do Hub. Isso é contrato entre os dois repos (8.7).
7. Limites explícitos na tela: “8 PDFs, 10 MB, foto até X”. Silêncio vira pendência visível.

#### 2.B — brisa-hub / brisa-analise

- Aceitar a lista de arquivos (URLs assinadas ou multipart) no job.
- O Playwright da FC/Migra usa o arquivo, não o texto da conversa.
- O lock do passo pago **continua**. Receber arquivo não autoriza cobrar.
- Documentar tamanho máximo e tipos. Recusar URL que não seja do Storage da instalação (anti-SSRF no Hub também).

#### Aceite da Fase 2

- [ ] Foto de holerite (sem PDF) produz valor com `fonte` + trecho, editável.
- [ ] PDF só-imagem passa pelo OCR/visão e não cai no `continue` silencioso.
- [ ] PDF com senha pede a senha no painel; senha errada não derruba o painel.
- [ ] Conversa com >200 mensagens analisa a janela útil e não devolve 422 de tamanho.
- [ ] Job no Hub lista os arquivos recebidos (log sem PII: nome, mime, bytes).
- [ ] Descrição genérica do worker (“parece um extrato”) **não** libera confirmação sozinha.

#### Teste da Fase 2

- Unitário: `fontesDaAnalise` / `lerPdfsOriginais` / senha / janela. Sabotar a linha do `tipo === "image" ? corpo` e ver o teste novo ficar vermelho.
- Fixture: `tests/fixtures/sample-text.pdf` (já usada) + um PDF rasterizado + uma imagem de holerite sintético (sem dado real de cliente).
- Par (doutrina `prova-em-par.md`): o mesmo holerite pela tela do painel e pela função `lerPdfsOriginais` / visão, texto cru idêntico.
- E2E de tela: um caso feliz com PDF de texto. Foto + OCR ficam `FORA_DO_CI` se dependerem de chave paga — motivo escrito no `e2e.yml`.

---

### Fase 3 — Processo no banco e participantes

**Objetivo:** o atendente não redigita. Existe um processo por interlocutor+imóvel, com N participantes; o WhatsApp não precisa ser locatário.

#### 3.A — DeskcommCRM

- Migration + baseline + `-- manifest:` com o modelo da §4 (sem o bucket ainda, se quiser fatiar; o mais barato é 3+3b juntos — pergunta 8.8).
- Regenerar `lib/database.types.ts` pelo fluxo do repo.
- API `/api/v1/locacao/processos` (lista/cria/atualiza) e participantes (CRUD) com Zod, `requireRole("agent")`, `requireSupportWrite` em mutação, `organization_id` da sessão, `ok()`/`fail()`, idempotência no POST (`Idempotency-Key`), rate limit do painel.
- Rota explícita de **aprovar processo** (só escreve `aprovado_por` / `aprovado_em` / `status=aprovado`). Nenhum outro handler escreve esses campos. Quem pode: o Felipe — na prática `admin` da org até ele pedir outro recorte (não inventar papel novo agora).
- Entrada em `lib/auth/public-paths.ts` **somente** se a rota aceitar bearer — no início, cookie basta.
- UI: no Painel, um bloco “Processo desta conversa” (status + imóvel + lista de participantes + último salvamento). Criar na primeira análise ou no primeiro “salvar”. Dá para acrescentar locatário/fiador/solidário que **não** é o contato da conversa.
- Cascata LGPD + export + invariante de isolamento.
- Fragmento `.changes/` (`capacidade_nova`): o operador da VPS passa a ter uma ficha que sobrevive à troca de conversa.
- Destino: **fork / nicho**. Não abrir PR no `melgarafael/DeskcommCRM` (Q15).

#### 3.B — brisa-hub

- Nada obrigatório. Se `consultar_contrato_inquilino` já devolve `id_pessoa_pes`, o CRM pode gravar o link no **participante** correspondente (não no contato, a menos que seja o interlocutor-participante), com o atendente ciente — pergunta 8.9.

#### Aceite da Fase 3

- [ ] Dois tenants: processo da org A invisível na org B (`pnpm test:db`).
- [ ] Processo com interlocutor ≠ locatário: a filha é o contato da conversa; o pai é participante sem `contact_id`.
- [ ] Trocar de conversa e voltar: a ficha e os N participantes estão lá.
- [ ] Anonimizar o interlocutor zera o atalho no contato e não apaga sozinho os outros participantes.
- [ ] Sem `superlogica_pessoa_id` em ninguém a Inbox continua útil.
- [ ] Terminar um passo de análise **não** marca `aprovado`.
- [ ] Nenhuma tabela espelha contrato/boleto.

#### Teste da Fase 3

- Invariantes: RLS das três tabelas, CHECK de status e de `papel`, unique (org, interlocutor, imóvel), cascata LGPD.
- Unitário das rotas (org no filtro, suporte só leitura, Zod, aprovação isolada).
- E2E: criar processo pela tela, acrescentar um locatário que não é o contato, recarregar.

---

### Fase 3b — Documentos no Storage, Drive e poda

**Objetivo:** cada anexo classificado mora numa pasta do processo. Contrato fechado → Drive da Brisa + backup na VPS. Processo morto → some em 90 dias.

#### 3b.A — DeskcommCRM

- Bucket `locacao-processos` + tabela `locacao_processo_documentos` (§4.4–4.5).
- Classificador: IA do ponto `painel_atendente` (ou `painel_documento`) sugere categoria; o atendente confirma. Sem confirmação, categoria = `outro`.
- Rota de upload/cópia a partir de `whatsapp-media` (service role, path check).
- Evento `event_log` tipo `locacao.contrato_arquivar` **depois** de `contrato_criado` com sucesso (Fase 5). Payload: `processo_id`, `organization_id`, `superlogica_contrato_id`, lista de paths. Sem bytes, sem CPF.
- Cron `data-retention`: chama `fn_expurgar_processos_de_locacao_vencidos`. Knob `LOCACAO_PROCESSO_RETENCAO_DIAS` (default 90, piso 90 no corpo).
- Aviso na Central se um processo `contrato_criado` ficar 24 h sem `arquivo_drive_url` (anti-morte).

#### 3b.B — n8n na VPS (preferido)

Um fluxo, disparado por webhook autenticado do CRM (ou polling do `event_log` via API com token `dsk_…` numa rota dual — só se já existir; não criar namespace paralelo):

1. Recebe `processo_id`.
2. Lista os arquivos pela API do CRM (URLs assinadas).
3. Cria/reusa pasta no Google Drive da Brisa: `Brisa Aluguéis / {imóvel} / {id_contrato ou nome-do-candidato} /`.
4. Copia os arquivos, por categoria.
5. Copia os mesmos bytes para `/var/brisa/arquivo-contratos/{id_contrato}/` na VPS.
6. Devolve ao CRM `arquivo_drive_url` + `arquivo_vps_path` (rota PATCH autenticada).
7. Falha → retry do n8n; o CRM não poda.

Credencial do Drive mora no n8n, **não** no `.env` do CRM.

#### 3b.C — brisa-hub

Nada. O Hub não arquiva.

#### Aceite da Fase 3b

- [ ] Caminho fora do padrão é recusado pelo CHECK (teste no `test:db`).
- [ ] Processo sem contrato, com 91 dias, some do banco **e** do bucket; processo com contrato permanece.
- [ ] n8n, em homolog, cria a pasta no Drive e o diretório na VPS para um processo de teste.
- [ ] PDF de LGPD / export não leva o arquivo do processo de outra pessoa.

#### Teste da Fase 3b

- Invariante do path + poda (espelhar o de `crm_lead_attachments`).
- Shell/n8n: fora do CI; evidência com pasta de teste no Drive (sem documento de cliente).

---

### Fase 4 — Painel «Análise da ficha cadastral»

**Objetivo:** quatro botões, cada um pré-preenchido, editável, salvo no processo, com andamento. Passo pago pede confirmação.

| Botão | Lê | Grava no processo | Pago? |
|---|---|---|---|
| Analisar renda | conversa + docs categoria `renda` | `renda` | não |
| Analisar FC | docs + dados conferidos | `resultado_fc` | **sim** (FC Score+) — segundo clique |
| Analisar seguro-fiança | docs + renda + imóvel | `cotacao_seguro` | se a Migra/seguradora cobrar — segundo clique |
| Gerar relatório agrupado | os três blocos já conferidos | `relatorio` | não |

#### 4.A — DeskcommCRM

- Seção nova no Painel (abaixo das ações atuais, ou no lugar do botão único “Iniciar análise”).
- Cada botão: GET do processo → pré-preenche → atendente edita → salva (Fase 3) → se for passo pago, mostra o checkbox de confirmação → POST ao Hub.
- Polling (ou leitura sob demanda) do andamento: `pedido_id` já existe. Mostrar `na fila` / `rodando` / `precisa confirmar pagamento` / `pronto` / `falhou`. Não afirmar que a FC terminou só porque o Hub aceitou o job (a decisão atual já proíbe isso).
- A IA **não** clica no passo pago e **não** aprova o processo. “FC pronta” ≠ `aprovado`.

#### 4.B — brisa-hub

- Quebrar `iniciar_analise_inquilino` em ferramentas (ou um `acao=` no mesmo job): `analisar_renda`, `analisar_fc`, `analisar_seguro`, `gerar_relatorio`.
- `analisar_fc` / seguro pago: o Hub já tem lock. O CRM manda `confirmado: true` só depois do checkbox.
- `GET` de status do job (se não entrou na Fase 1).

#### Aceite da Fase 4

- [ ] Os quatro botões existem; suporte só leitura os vê desabilitados.
- [ ] Salvar renda sem confirmar FC **não** chama o serviço cobrado.
- [ ] Confirmar FC sem checkbox é 400.
- [ ] Andamento visível; falha visível; retry não duplica (idempotência).
- [ ] Relatório usa só o que está no processo, não relê a conversa inteira às cegas.
- [ ] Os quatro “ok” juntos **não** mudam `aprovado_por` / `aprovado_em`.

#### Teste da Fase 4

- Unitário de UI (quatro botões, checkbox, polling).
- Rota: não chama Hub no salvar local; chama no confirmar pago.
- Par: o mesmo pedido de FC pela tela e pela ferramenta do Hub.

---

### Fase 5 — Gerar contrato (sempre disponível; pré-preenche se houver processo)

**Objetivo:** o botão de hoje não some. Com processo, o diálogo nasce preenchido. Com ou sem aprovação. No sucesso, o CRM guarda os links e dispara o arquivo. Nada se cria sozinho.

#### 5.A — DeskcommCRM

- `Gerar contrato` permanece no painel em **qualquer** conversa, com ou sem processo, com ou sem `aprovado` (Q10). O formulário vazio atual continua o caminho válido.
- Se existe processo nesta conversa/imóvel, o diálogo mapeia `locacao_processo_participantes` (locatário / fiador / solidário) + imóvel + aluguel/garantia/seguro conferidos para `DadosContrato`. Campos que o Hub exige e o processo não tem ficam vazios, obrigatórios como hoje. O atendente edita à vontade.
- Status `aprovado` **não** habilita nem esconde o botão. É marca humana do Felipe, à parte.
- Confirmar a locação continua sendo o checkbox + `confirmado: true` de hoje. Análise “ok” não dispara isso.
- No `gravado: true`: UPDATE do processo (`superlogica_contrato_id`, `status=contrato_criado`); UPDATE de `participantes.superlogica_pessoa_id` para cada id que o Hub devolver; atalho em `contacts.superlogica_pessoa_id` **só** se o interlocutor for um desses participantes. Não sobrescrever um id diferente sem o atendente confirmar.
- Emite `locacao.contrato_arquivar` para o n8n.
- Auditoria já existente + a nova, sem PII.

#### 5.B — brisa-hub

- `confirmar` devolve `id_contrato`, `situacao` e a lista de `id_pessoa_pes` com papel (locatário/fiador/solidário).
- Continua criando ATIVO, despesas, idempotência.

#### Aceite da Fase 5

- [ ] Sem processo: o diálogo vazio abre e prepara como hoje.
- [ ] Com processo (mesmo `rascunho` ou `relatorio_pronto`, **sem** `aprovado`): o diálogo abre preenchido; dá para editar e preparar.
- [ ] Com processo em que o interlocutor não é locatário: o formulário lista o pai/mãe (participante) e não assume o contato do WhatsApp como locatário.
- [ ] Confirmar grava `id_contrato` e os ids das pessoas nos **participantes**.
- [ ] Segunda confirmação da mesma prévia não cria segundo contrato nem segundo UPDATE conflitante.
- [ ] Nenhum caminho cria locação sem o checkbox.

#### Teste da Fase 5

- Unitário do mapeamento participantes → `DadosContrato`, inclusive interlocutor ≠ locatário.
- Unitário: botão visível sem processo e sem `aprovado`.
- Rota: sucesso grava ids nos participantes; Hub sem `id_pessoa_pes` não inventa; id diferente pede confirmação.
- Homolog: um contrato de teste, depois o n8n da 3b.

---

## 6. Ordem sugerida

```
Fase 1  (operação + Hub)     ── sem isto, o resto é teatro
   │
Fase 2  (ler anexos)         ── pode começar o desenho no CRM em paralelo
   │                            à publicação do Hub, mas o aceite precisa dos dois
   │
Fase 3  (processo + N participantes) ── desbloqueia 3b, 4 e 5
   │
   ├─ Fase 3b (Storage + n8n) ── pode ir em paralelo com a 4
   │
   └─ Fase 4 (quatro botões) ── precisa do GET de job no Hub
          │
        Fase 5 (contrato sempre no painel; pré-preenche se houver processo)
```

O botão 7 (manutenção) **não entra** (Q11). Fora da ordem.

Não misturar fases num PR só. Cada fase: branch `cursor/…`, testes daquela fase, fragmento `.changes/` se o operador da VPS perceber, documento de decisão atualizado, PR para o Felipe revisar.

---

## 7. Riscos

| Risco | Por que importa | Mitigação |
|---|---|---|
| Hub ainda não publicado | Fase 1 não fecha; as outras empilham dívida | Parar no checklist 1.A. Não começar schema |
| URL `/mcp` → `/contrato` quebra | O código do CRM já está na `main` e parece pronto | 8.1; se quebrar, URL explícita |
| Chave do CRM fora de `CONTRATO_KEYS_SHA256` | Tela mostra erro genérico de permissão | Checklist 1.A.2; o Hub documenta o hash |
| Visão ≠ OCR financeiro | Foto “lida” com número errado vira renda | Confirmação humana; teste que a descrição genérica **não** libera |
| OCR caro / lento | Gemini no ponto do painel conta no orçamento do mês | Ponto separado; teto de páginas; recusar silêncio |
| Cópia de documento × LGPD | Bucket novo cresce; 1 GB do Supabase é o mesmo do WhatsApp | Poda 90 dias; arquivar no Drive tira a pressão; não espelhar o ERP |
| n8n fora do ar | Contrato existe e a pasta não | Status `contrato_criado` sem arquivo não poda; aviso na Central |
| Contrato ATIVO demais | Homolog cria locação de verdade | Imóvel/conta de teste; nunca cliente real na Fase 1 |
| Interlocutor ≠ locatário | Assumir que o contato do WhatsApp é quem aluga cria contrato no nome da filha | Participantes N; interlocutor é só a porta da conversa (Q3) |
| Análise “ok” virar aprovação | O Felipe perde o veto | `aprovado_por` só pela rota de aprovação; Gerar contrato não exige esse status (Q10) |
| Subir isso no Deskcomm original | Tabela de locação não serve clínica nem loja | Destino = fork (Q15). Núcleo só o consumidor MCP que já está |
| `brisa-hub` inacessível para a IA | Este plano pode ter errado o contrato do Hub | 8.2; o outro bot confirma OpenAPI antes de implementar 2 e 4 |

---

## 8. Perguntas para o Felipe

Resposta curta basta. Sem resposta, a implementação **não inventa**. As decididas já foram aplicadas neste documento (modelo §4, Fases 3 e 5, ordem).

| # | Pergunta | Estado | Resposta (27/10/2026) |
|---|---|---|---|
| 1 | URL do contrato: derivar `…/mcp` → `…/contrato/{etapa}`, ou campo extra no cadastro MCP? | **Aberta — em verificação à parte** | — |
| 2 | Hub com o PR #22 já está no ar? Quais ferramentas o “Testar conexão” lista? | **Aberta — em verificação à parte** | — |
| 3 | Um WhatsApp, várias pessoas no contrato? | **Decidida** | Cada pessoa = uma pessoa no SuperLógica; casal no mesmo número não é o caso comum. O contrato pode incluir quem **não** é o contato do WhatsApp (filha fala, pai/mãe aluga). Processo com **N participantes** (locatário / fiador / solidário), cada um opcionalmente ligado a um contato do CRM e a um `superlogica_pessoa_id`. O contato do WhatsApp é só o **interlocutor**. |
| 4 | CPF de quem não é contato: cifrado no participante, ou redigita na hora do contrato? | Aberta | — |
| 5 | Teto de OCR: 8 páginas ou 8 MB, o que vier primeiro? | Aberta | — |
| 6 | Conversa longa: 80 úteis ou 400 brutas + 60 mil caracteres? | Aberta | — |
| 7 | Arquivo no Hub: URL assinada ou multipart? | Aberta | — |
| 8 | Fase 3 e 3b juntas num PR? | Aberta | — |
| 9 | Gravar `id_pessoa_pes` já na consulta, ou só ao criar o contrato? | Aberta | — |
| 10 | Gerar contrato só com processo aprovado? | **Decidida** | O botão **sempre** existe; o formulário vazio de hoje continua válido. Aprovação é **decisão manual do Felipe, obrigatória como ato dele**, mesmo se todos os passos de análise disserem ok. O processo só pré-preenche quando existe. **Nada auto-aprova nem auto-cria.** |
| 11 | Chamado de manutenção (botão 7)? | **Decidida** | Depois, **fora deste plano**. |
| 12 | Pasta do Drive: `Brisa Aluguéis / {imóvel} / {id do contrato}/`, n8n cria a pasta-mãe? | Aberta | — |
| 13 | Backup VPS em `/var/brisa/arquivo-contratos/{id_contrato}/`? Por quanto tempo? | Aberta | — |
| 14 | Seguro-fiança também exige segundo clique sempre, ou só quando o Hub for cobrar? | Aberta | — |
| 15 | Tabelas novas só neste fork? | **Decidida** | Sim. **Não** sobe para `melgarafael/DeskcommCRM`. |

---

## 9. Trilha para a próxima IA (AGENTS-style)

Antes de escrever código:

1. Ler este arquivo inteiro. A §8 já traz o que o Felipe decidiu (Q3, Q10, Q11, Q15) e o que ainda está aberto (Q1/Q2 em verificação). Sem o “pode ir à Fase 1”, não escrever produto.
2. Ler [`docs/decisoes/painel-agente.md`](../decisoes/painel-agente.md) e [`docs/decisoes/painel-acoes-hub.md`](../decisoes/painel-acoes-hub.md). Se a fase mudar comportamento, **emendar** esses dois — não criar uma terceira verdade.
3. Rodar `bash .agents/skills/deskcomm-contribuir/scripts/quem-sou.sh` e `git fetch origin main`. Branch nova a partir de `origin/main`, nome `cursor/<fase>-5267` (ou o sufixo da sessão).
4. **Uma fase por PR.** Fase 1 sem schema. Fase 3 com tripla de migration. Não editar migration já aplicada.
5. `organization_id` da sessão. `requireSupportWrite` em mutação. Sem `getSession()`. Sem `console.log`. Sem marca “Deskcomm” na UI.
6. SuperLógica só via Hub. Sem tabela espelho. Sem mensagem ao cliente sem o atendente clicar em enviar.
7. Ao fechar a fase: atualizar a tabela da §1 (“Pronto para usar?”), anexar evidência, listar **O que NÃO medi**.
8. Living System Checklist da peça nova (entrada, saída, audit, tela, porta, anti-morte, laço). Mapa em `docs/architecture/` com ≥2 arestas.
9. Destino = fork (Q15). Não abrir PR upstream.

Contrato que o CRM já exige do Hub (não reinventar nomes): `lib/agent-engine/agent/painel-acoes-hub.ts` e `lib/agent-engine/agent/painel-contrato.ts`.

---

## 10. O que este plano NÃO mediu

- O repositório `felpzGondim/brisa-hub` (404 neste ambiente). OpenAPI, variáveis reais da VPS, se o PR #22 mergeou, se o `brisa-analise` já aceita arquivo: **NÃO MEDIDO**.
- Se a instalação de produção (`v1.88.0-felpz.5`) já puxou a imagem que contém o PR #8. A tag aponta para `905b1027c`, que inclui o merge — o `update.sh` da VPS é passo do Felipe.
- SuperLógica de homologação (campos obrigatórios além dos que o diálogo já pede).
- Cota atual do Storage e do Drive da Brisa.
- Se o n8n da VPS já tem credencial do Google Drive.
- Playwright real de FC/Migra (custo, seletor, lock).
- O botão 7 e qualquer fluxo de manutenção (fora deste plano, Q11).
- Q1/Q2: URL real do Hub e se o PR #22 já está na VPS — **em verificação à parte**, não assumir.

Fim do rascunho. A implementação espera o “pode ir à Fase 1”. Q1 e Q2 ainda podem mudar o checklist da Fase 1, não o modelo das Fases 3–5.

---

## Adendo: análise completa de inquilino no CRM

**Status:** plano, só leitura. Nada foi mudado no banco, no código em produção, no Hub ou na VPS.
**Data do levantamento:** 28/10/2026. **Emendas:** 28/10 (objetivo), 28/10 00:19 e 28/10 00:21 (respostas do Felipe).
**Pedido do Felipe (27/10):** "Eu quero que leia sim. Podemos até criar uma função pra isso. Na prática o que eu quero é o que o Análise De Inquilinos já faz sozinho, mas dentro do CRM."
**Esclarecimento do objetivo (28/10, Felipe):** "A ideia é que a IA analise os documentos e a conversa, faça aquele relatório preliminar, já com todos os dados para serem usados nas fases posteriores da esteira."
**Liga com:** Fase 2 (PR #15, leitura de anexos), Fase 3 e 3b (processo, documentos, Storage) e Fase 4 (os botões) deste plano. O passo **central** deste adendo é o **Relatório preliminar** (A.6 / fase A1): relatório de 6 seções + registro estruturado que a ficha, a FC, a Migra e o `/contrato/preparar` reutilizam sem redigitar.
**Fase 3 (proposta, 28/10 00:56, só validação):** plano detalhado da entidade processo — [`fase3-processo-locacao.md`](fase3-processo-locacao.md). **Fase 3.5** (vínculo contato ↔ Superlógica pelo telefone, id no contato; 28/10 01:04) — [`fase3-5-vinculo-superlogica.md`](fase3-5-vinculo-superlogica.md). Sem implementação.

### Decisões do Felipe (28/10/2026)

00:19 fechou b, c, d, e, h e i. 00:21 fechou a, f e autorizou g.

| # | Tema | Decisão | Estado |
|---|---|---|---|
| a | Arquivos | Ficam no CRM; o Hub recebe **só dados**. O PR #15 já lê extratos e fotos de documento (CNH etc.) por visão/OCR. | **Fechada** (00:21) |
| b | Robô Playwright (FC/Migra) | **Aceita** o risco de termos de uso. | Decidida (00:19) |
| c | Cobrança da FC | O clique em **Gerar análise** no CRM **é** a autorização da cobrança. Sem segundo clique obrigatório (no máximo um "ok" na mesma tela). **Mantém** a trava anti-cobrança em dobro (idempotência / lock por pretendente). | Decidida (00:19) |
| d | Migra | A cotação **não tem custo**. | Decidida (00:19) |
| e | Ordem das fases | Quem decide a ordem somos nós; ele só usa quando **tudo** estiver pronto. Ordem vigente: A0 → A1 → A2 → A3 → A4 → A5 → A6. | Decidida (00:19) |
| f | Retenção | **5 dias** no Hub (não 24 h); **90 dias** no CRM. | **Fechada** (00:21) |
| g | Teste A0 (robô, parando antes do passo pago) | **Autorizado**, com as regras da § A.0 abaixo. | Autorizado (00:21). **Resultado ainda não registrado.** |
| h | API oficial | Ele **já perguntou** à FC e à Migra; **não existe API** ainda. Não enviar e-mails. Revisitar quando existir. | Decidida (00:19) |
| i | Bot Análise De Inquilinos | Continua **em paralelo**. | Decidida (00:19) |

**Ainda aberto (só isto):** o **resultado do A0** (quando o teste rodar, gravar aqui).

#### Regras do A0 (autorizado em 00:21)

- Parar **antes** de qualquer passo **pago** da FC (só SALVAR / PENDENTE; nunca "Processar ANÁLISE").
- **Zero cobrança.**
- Dados **fictícios / de teste**. CPF de candidato real **só se ele pedir**.
- Sessão expirada, login, 2FA ou captcha: **parar**. Não contornar.
- O resultado deste teste será registrado depois.

---

### A.1 Resumo em 6 linhas

1. O bot **Análise De Inquilinos** faz tudo hoje pelo navegador do computador dele: lê os arquivos, analisa a renda, roda a FC Score+, cota na Migra e escreve o relatório de 6 seções.
2. Boa parte da parte "robô" **já existe na VPS**: o container `brisa-hub-analise` (Playwright) já sabe entrar na FC e na Migra, salvar a ficha, cotar e baixar o laudo. Mas ele **nunca rodou um caso real registrado** e o CRM só consegue **dar a partida**. Ele não consegue acompanhar, confirmar a cobrança nem receber o resultado.
3. **Achado importante:** nem a automação da FC nem a da Migra envia arquivo para o site. As duas só preenchem formulário com dados. **Os arquivos do candidato só servem para a leitura no CRM e para o arquivo do processo**, e isso pode ficar 100% dentro do CRM (o PR #15 já lê os anexos).
4. **Arquivos ficam no CRM** (decisão a, fechada em 00:21). O PR #15 já lê extratos e fotos de documento (CNH etc.) por visão/OCR. O Hub recebe **só dados estruturados** (depois da revisão do atendente) e devolve **resultados** (cards da Migra, ID e laudo da FC).
5. **O passo central é o Relatório preliminar, no CRM, com o Gemini do provedor já cadastrado.** A IA lê as **200 mensagens mais recentes** e o texto dos anexos (PR #15) e devolve (1) o relatório de 6 seções do bot e (2) um **registro JSON** com os dados da esteira. O atendente revisa e edita **antes** de ficha, FC, Migra ou contrato usarem qualquer campo.
6. FC e Migra ficam **no Hub (Playwright)** — o Felipe **aceitou** o risco de termos de uso (decisão b). Manual assistido continua de reserva. O relatório **completo** (com score, restrições e cards) vem **depois**. O bot Análise De Inquilinos **segue em paralelo** (decisão i). Dá para entregar em fases pequenas, cada uma com chave liga/desliga; ele só usa quando o conjunto estiver pronto (decisão e).

---

### A.2 O que o bot Análise De Inquilinos faz hoje

Fonte: as skills do bot (`nova-analise-de-inquilino`, `analise-financeira-inquilino`, `iniciar-analise-fc-score`, `cotar-seguro-fianca-migra`, `PROMPT-FORMATO.md`) e o histórico recente dele. Nenhum dado pessoal foi copiado.

| Passo | Como faz | Observação |
|---|---|---|
| 1. Receber dados e arquivos | Outro bot lê o WhatsApp e passa os dados e arquivos para ele. Ele extrai o texto dos PDFs. | Depende de alguém "acordar" o bot e repassar. É frágil: no histórico houve vezes em que os dados não chegaram até ele. |
| 2. Análise bancária | Lê os extratos e holerites. Tira autotransferências, poupança e Rende Fácil. PIX de terceiros não conta como renda fixa. | Propõe a **renda para a FC**. |
| 3. FC Score+ | No site `cliente.fcanalise.com.br`: preenche, clica em **SALVAR** (grátis, gera o ID-FC, status PENDENTE) e **pergunta antes** de "Processar ANÁLISE" (pago). | O "sim" para cobrar vale para uma vez só. |
| 4. Migra | No site `migra.app.br`, Multi Cálculo PF Residencial: preenche e clica em **Analisar**. **Nunca** em Contratar. | Precisa de e-mail e celular. Os colocatários entram como solidários. |
| 5. Relatório | 6 seções: Identificação, Resumo, Crédito, Renda, Financeira/Despesas, Risco para Locação. | Nunca diz "alugue" ou "não alugue". Diz risco **baixo, moderado ou alto**. |

Regras de preenchimento que o CRM precisa herdar:
- Cód. imóvel = primeira palavra da rua + número do apartamento.
- Início da vigência = hoje + 5 dias. Fim = início + 30 meses.

---

### A.3 O que já existe no Brisa Hub (lido na VPS em 28/10)

**Container `brisa-hub-analise` v0.1** (Python + Playwright 1.64, sem porta publicada, limite de 900 MB, um job por vez):

- Rede interna com o Hub e o n8n. Sai para a internet só para falar com a FC e a Migra.
- Login automático na FC e na Migra com usuário e senha guardados em `/root/.config/brisa-hub/analise/` (os valores não foram lidos). Os cookies ficam em `/data/sessions`. A última sessão gravada é de 25/10 às 23:10, então é provável que já tenha expirado. Se expirou, o job vai para `login_necessario` e pode ser retomado.
- **FC:** SALVAR → resumo com ID-FC → PENDENTE. "Processar ANÁLISE" só roda em `confirmar-cobranca-fc`. Depois disso, espera uns 3 minutos, consulta por até uns 15 minutos e salva o laudo em PDF.
- **Migra:** só Analisar. Espera o modal (uns 90 segundos), tira um print e lê os cards (seguradora, código da cotação, status, planos).
- **Máquina de estados:** `recebido → renda_preliminar → aguardando_renda → dados_para_confirmar → aguardando_confirmacao → migra_cotando → fc_salvo_pendente → aguardando_cobranca_fc → fc_processado → concluido`. Os estados de erro são `erro` e `login_necessario`.
- **Documentos:** aceita PDF, JPG, PNG e WEBP, até 8 MB cada e 20 por job. Só usa os arquivos para **somar valores por regex** (`renda.py`, sem IA). O próprio código diz que o relatório de renda "é escrito pelo n8n/Grok", ou seja, **ninguém escreve hoje**.
- **Retenção hoje no container:** um job parado some em 24 h; os arquivos somem 24 h depois da conclusão. **Decisão f (00:21):** a política passa a ser **5 dias** no Hub. As respostas mascaram o CPF e os logs não mostram CPF nem texto de extrato. Os prints de auditoria ficam na pasta do job.
- **Uso real:** 0 jobs no disco. O log mostra só a subida do container (27/10, 12:02) e um teste 404. **Trate como não validado em produção.**

**Hub `brisa-hub` (MCP) v0.4:** a ferramenta `iniciar_analise_inquilino` existe só para o papel `crm`.
- Recebe `pedido_id`, `conversa_id`, `organization_id`, `candidato`, `imovel` e `renda`. **Não tem campo de arquivos.**
- Chama `/jobs/iniciar-do-crm`, que é idempotente e roda **Migra + FC SALVAR juntas** em segundo plano.
- Responde só `aceito`, `ja_existia`, `indisponivel` etc.

**O que falta para o CRM fazer o ciclo inteiro:**

| Lacuna | Onde |
|---|---|
| Ver o andamento e o resultado do job (status, cards da Migra, ID-FC) | Hub: falta a ferramenta de status. Já estava prevista como "Fase 1.B, outro PR" no `docs/AGENTS.md`. |
| Disparar a análise cobrada da FC a partir do CRM | O clique **Gerar análise** já autoriza a cobrança (decisão c). O Hub ainda precisa processar o passo pago nesse mesmo pedido, com lock por pretendente. Sem segundo clique no CRM. |
| Rodar Migra e FC separadas (um botão para cada) | Hub: hoje é uma partida única para as duas. |
| Trazer o laudo PDF da FC e o print da Migra para o CRM | Hub: o arquivo existe em `/jobs/{id}/arquivo/...`, mas não há caminho pelo MCP. |
| Relatório preliminar de 6 seções + registro estruturado (o passo central) | Ninguém faz. Proposta: CRM (fase A1). |
| Análise de renda escrita (não só a soma) | Absorvida pelo Relatório preliminar. |
| Relatório completo com FC/Migra | Ninguém faz. Proposta: CRM, **depois** dos resultados do Hub. |
| Guardar os resultados no processo | CRM, Fase 3 / 3b (tabela do processo e bucket `locacao-processos`). |

Nota de histórico: a nota de arquitetura de 18/10 dizia "sem navegador na VPS; FC e Migra continuam com o bot". Isso **foi superado** quando o `brisa-hub-analise` com Playwright subiu. Este adendo registra a mudança.

---

### A.4 Como os arquivos chegam (resposta à Q7)

**Ponto de partida:** a FC e a Migra **não recebem arquivo**. Então a pergunta certa não é "como mandar arquivo para o Hub", e sim "**quem precisa ler o arquivo**". Resposta: só o Relatório preliminar (conversa + anexos) e o arquivo do processo. Os dois ficam no CRM.

| Opção | Como funciona | Prós | Contras | LGPD / retenção |
|---|---|---|---|---|
| **0. Não mandar (recomendado)** | O CRM lê a conversa e os anexos (PR #15), monta o Relatório preliminar + o registro, e manda ao Hub só os dados **já revisados** (nome, CPF, renda confirmada, imóvel, contatos). | Nenhuma cópia extra de extrato na VPS. Nada novo para proteger. Nenhuma mudança no Hub para isso. | O `renda.py` do Hub (soma por regex) deixa de ser usado, ou vira só uma conferência opcional. | É a menor exposição possível: o arquivo mora só no Storage do CRM. |
| 1. URL assinada | O CRM gera URLs do Storage válidas por 15 minutos (o PR #15 já faz isso se o schema anunciar `arquivos`). O Hub baixa os arquivos em segundo plano. | Padrão comum. Não passa bytes pelo MCP. | Precisa de lista de hosts permitidos (anti-SSRF), limite de tamanho e de tipo, e download assíncrono (o MCP tem só 12 s). Gera uma segunda cópia na VPS. | A cópia do Hub some em **5 dias** (decisão f; hoje o container ainda corta em 24 h). A URL expira em 15 min. |
| 2. Base64 / multipart no MCP | Os bytes vão dentro da chamada. | Simples para foto pequena. | Um extrato de 20 MB vira uns 27 MB de JSON passando pelo Caddy, num Hub com limite de 256 MB. Ruim. | Os bytes passam por mais camadas. |
| 3. Endpoint HTTP novo no Hub | Rota `POST` multipart fora do MCP, com a chave do CRM. | Aguenta arquivo grande. | Mais uma porta pública para proteger e testar. | Igual à opção 1. |
| 4. Pasta temporária compartilhada | O CRM e o Hub estão na mesma VPS: uma pasta montada nos dois containers. | Rápido, sem rede. | Amarra os dois sistemas (se o CRM mudar de servidor, quebra). Dá trabalho com permissão de usuário. É difícil auditar quem leu. | Precisa de uma limpeza própria. |

**Q7 fechada (decisão a, 00:21):** opção **0**. Arquivos ficam no CRM — o PR #15 já lê extratos e fotos de documento (CNH etc.) por visão/OCR. O Hub recebe só dados. A **opção 1** fica só como caminho futuro, se algum site passar a exigir upload de documento.

**Retenção (decisão f, fechada em 00:21):**
- **5 dias** no Hub (job, arquivos, prints de auditoria). Hoje o container ainda corta em 24 h — alinhar na implementação.
- **90 dias** no CRM (bucket `locacao-processos`): some se não virar contrato; se virar, vai para o Drive e o backup na VPS (§4.6 / Fase 3b).
- Arquivo original da conversa: `whatsapp-media`, regra atual.
- Logs e `audit()`: sem CPF, sem bytes, sem texto de extrato.
- A análise de crédito para locação se apoia na base legal de proteção do crédito e no procedimento pré-contratual. A FC exige usuário com CRECI ativo, o que a Brisa já tem.

---

### A.5 Como trazer a FC e a Migra para o CRM

| Opção | Como funciona | Prós | Riscos e contras | Custo |
|---|---|---|---|---|
| **A. Playwright no Hub (caminho principal — decisão b)** | O `brisa-hub-analise`, que já existe. O CRM pede, acompanha e dispara pelo MCP. | Já está quase pronto. Roda sem depender do computador do bot. Já tem retomada em `login_necessario`. | O Felipe **aceitou** o risco de termos de uso (28/10). **Captcha:** hoje não há, mas pode aparecer. **Layout:** se o site mudar, o robô quebra. **Sessão:** expira e exige novo login. **Memória:** o Chromium usa 300 a 600 MB (há uns 2 GB livres e o limite do container é 900 MB). Um job por vez. | Sem custo novo de servidor. Só o trabalho de desenvolvimento. |
| B. Bot Análise De Inquilinos como executor (webhook) | O CRM dispara o bot, que faz no navegador dele e devolve o resultado. | Usa o fluxo que já funciona hoje. | Não existe um gatilho estável de "chamar o bot e receber a resposta estruturada". O retorno é texto, não dados. Os dados pessoais passam por mais um sistema. Depende do computador do bot estar livre. É mais lento. | Uso do bot por análise. |
| **C. Manual assistido (recomendado como reserva)** | O CRM mostra os dados já formatados (com botão de copiar) e o link da FC e da Migra. O atendente faz no site e sobe o laudo PDF ou o print. O Gemini lê e preenche o bloco. | Zero risco de termos de uso ou de captcha. Sempre funciona. | Mais cliques. Depende de o atendente subir o arquivo certo. | Só a IA para ler o laudo (centavos). |
| D. API oficial (quando existir) | A FC tem integrações com sistemas imobiliários (Imoview/Universal, Imobzi, Rede Izee, Rua Dois, Si9, Sohtec) e um painel de desenvolvedor fechado (`devpanel.fcanalise.com.br`). A skill do bot cita `api.fichacertadigital.com.br` "se a conta tiver permissão de API". A Migra anuncia "integração API REST com chaves únicas por imobiliária" (usada por Imobzi, Vistasoft, Immobile, Pleno), com token fornecido por ela. | É o caminho mais estável e dentro das regras. Sem navegador. | **Decisão h (28/10):** o Felipe **já perguntou**; **não existe API** ainda. Sem e-mail nosso. Revisitar quando existir. A Superlógica (Hub de Garantias) ainda não tem seguro fiança ("em breve"). | A combinar com cada empresa, se um dia houver. |

**Recomendação:** **A + C** na mesma tela. A é o caminho normal (risco de termos **aceito**). C entra sozinho quando o job cair em `erro` ou `login_necessario`, ou quando a chave do robô estiver desligada. **D** só quando a API existir — não pedir de novo.

O bot Análise De Inquilinos (B) **continua em paralelo** (decisão i). Não desligar quando o CRM nascer.

---

### A.6 Os botões da Fase 4, já com o desenho acima

O antigo "Analisar renda" **some como botão isolado**. Ele vira o passo **primeiro e central**: **Relatório preliminar**. A renda, o empregador, os documentos e o restante da ficha saem desse passo, num registro que o atendente edita. FC, Migra, ficha cadastral e `/contrato/preparar` **não relêem a conversa** — consomem o registro já revisado.

| Botão | Quem faz | Custo em dinheiro | Trava | Resultado guardado |
|---|---|---|---|---|
| **1. Relatório preliminar** (central) | CRM. Gemini pelo provedor já cadastrado (ponto `painel_atendente` ou, se o Felipe quiser o custo à parte, `painel_analise`). Lê as **200 mensagens mais recentes** (é o teto que o botão "Iniciar análise" já usa hoje — CONFIRMADO em `painel-analise-preparo.ts`) e o texto dos anexos (PR #15). Aplica as regras da skill `analise-financeira-inquilino` (tira autotransferência, poupança e Rende Fácil; PIX de terceiros não é renda fixa) e o `PROMPT-FORMATO.md` (6 seções). Devolve **dois artefatos**: o relatório preliminar e o registro JSON da § A.6b. | Só IA: centavos a poucos reais num extrato longo escaneado, em `llm_calls`. | O atendente **revisa e edita** o registro (e o texto) **antes** de qualquer passo seguinte. Sem essa revisão, FC, Migra, ficha e contrato ficam cinza. Isto **não** aprova o processo (Q10). | Blocos `relatorio_preliminar` (6 seções) e `ficha` (JSON). A renda proposta para a FC mora **dentro** da ficha, não num botão à parte. |
| **2. Analisar seguro-fiança** | Hub, com acao `seguro` (só Migra, só **Analisar**). O CRM manda os campos da ficha já revisada (A.6c). Acompanha pelo status. | **R$ 0** na cotação (decisão d, 28/10). "Contratar" **nunca** aparece. | Um clique. Exige ficha revisada. | Bloco "seguro": seguradoras, código da cotação, status, planos e o print. |
| **3. Gerar análise (FC)** | Hub. O CRM manda os campos da ficha já revisada (A.6c). **Um clique** em **Gerar análise** **é** a autorização da cobrança (decisão c). No máximo um "ok" / valor na **mesma** tela — sem segundo clique obrigatório, sem caixa à parte. Por baixo, o Hub ainda pode SALVAR e processar no mesmo pedido. | **FC Score+**: na tabela pública, **R$ 25,30 avulso pré-pago** (de R$ 32,00), com uma faixa de **R$ 17,60**. O valor real depende do plano da Brisa. Provavelmente é cobrado **por pretendente**. | Exige ficha revisada. **Trava anti-dobro** (obrigatória): idempotência / lock por pretendente (mesmo CPF / mesmo ID-FC). O Hub recusa repetir. `audit()` no clique. | Bloco "fc": ID-FC, score e risco, restrições e o laudo PDF. |
| **4. Relatório completo** | CRM. O Gemini usa o `PROMPT-FORMATO.md` (as mesmas 6 seções) e **só** os blocos já guardados: `relatorio_preliminar` + `ficha` + `seguro` + `fc`. **Nunca** relê a conversa crua. | Só IA (centavos). | O texto é editável. O Felipe aprova o **processo** à parte (Q10). Nunca diz "alugue / não alugue", só risco baixo, moderado ou alto. | Bloco `relatorio` mais um PDF no processo (categoria `relatorio`). |

A ficha cadastral que já existe no painel (botão 4 da §1) **também** passa a ler `ficha.documentos` depois da revisão: o que falta vira o pedido no Composer, sem a IA reler anexos.

**Mudanças no Hub (todas do papel `crm`, todas atrás de uma chave):**
1. `status_analise_inquilino(pedido_id)`: só leitura. Devolve estado, cards da Migra, ID-FC, se há laudo e o erro, se houver. (É a "Fase 1.B" que já estava prevista.)
2. Campo `acao` em `iniciar_analise_inquilino` com os valores `seguro` e `fc_gerar` (ou o nome que o Hub já tiver para o passo pago). O comportamento antigo (as duas juntas) continua como padrão até o CRM migrar. A entrada `candidato` / `imovel` / `renda` sai do registro revisado, não de uma segunda leitura da conversa.
3. O clique **Gerar análise** no CRM **já autoriza a cobrança** (decisão c). Sem ferramenta de "segundo clique" obrigatória. Se o Hub ainda tiver `confirmar-cobranca-fc` por dentro, o CRM dispara no mesmo pedido — no máximo um "ok" / valor na mesma tela. **Lock / idempotência por pretendente** (CPF ou ID-FC): recusa a segunda cobrança. `audit()` no clique.
4. `baixar_resultado_analise(pedido_id, tipo: laudo|print_migra)`: devolve o arquivo (laudo e print são pequenos, abaixo de 2 MB) **ou** sobe direto numa URL de upload assinada que o CRM fornece. Escolher uma das duas na implementação.
5. **Não** adicionar campo de arquivos (veja A.4). Q7 fechada: arquivos no CRM, Hub só dados.

**Mudanças no CRM:**
- Botão **Relatório preliminar** no Painel do Agente (no lugar do "Iniciar análise" único, ou acima dos outros). FC/Migra/relatório completo só habilitam depois da revisão.
- Uma rota de IA nova: `relatorio_preliminar` (200 mensagens + anexos do PR #15 → texto de 6 seções + JSON da § A.6b). Reaproveita o ponto `painel_atendente` / `visao_de_imagem`. A rota do relatório **completo** é outra, e só vê blocos guardados.
- Tela de revisão/edição do registro (CPF **mascarado** na UI; o valor completo só viaja ao Hub ou ao `/contrato/preparar` depois do clique do atendente).
- Acompanhamento de job FC/Migra a cada 10–20 s enquanto houver job ativo.
- Modo manual assistido (opção C), com upload do laudo e do print.
- Chave por org em `organizations.settings.locacao.analise` (`preliminar`, `seguro`, `fc`, `relatorio`, `manual`). A chave `renda` do rascunho anterior **não** existe — foi absorvida por `preliminar`.

---

### A.6b Onde o registro mora, e o schema

**Antes da Fase 3 (processo ainda não existe):** só na tela, no mesmo padrão da prévia de hoje (CONFIRMADO em `docs/decisoes/painel-acoes-hub.md` e `painel-analise-preparo.ts`): token cifrado, preso a org + conversa + usuário, TTL de 30 minutos. Fecha o painel, some. Não há tabela. É o mesmo recorte do PR #15.

**Na Fase 3:** o atendente "Salva no processo". Aí o registro vira jsonb no processo, e os participantes saem dele (sem redigitar):

| Onde | Campo proposto | O que guarda |
|---|---|---|
| `locacao_processos` | `ficha jsonb` | O registro da § A.6b, **já revisado**. É a fonte que FC, Migra, ficha cadastral e contrato lêem. |
| `locacao_processos` | `relatorio_preliminar jsonb` | As 6 seções em texto (editável). Não é o relatório completo. |
| `locacao_processos` | `renda` / `resultado_fc` / `cotacao_seguro` / `relatorio` | Continuam como na §4.3: renda extraída da ficha na revisão; os outros três nascem nos botões 2–4. |
| `locacao_processo_participantes` | uma linha por pessoa da ficha | `papel` (`locatario` / `fiador` / `solidario`), nome, e-mail, `cpf_mascarado`, `contact_id` se der para ligar. CPF completo **não** mora em claro (pergunta 8.4). |
| `locacao_processos` | `imovel_*` | Endereço / código FC / identidade já previstos na §4.3, preenchidos a partir de `ficha.imovel`. |

DIRC: o registro é **o conferido neste processo**, não um espelho do SuperLógica. A conversa continua a fonte original; a ficha é o recorte que o atendente topou reutilizar. Sem revisão, nenhum passo seguinte lê o JSON cru da IA.

Schema proposto do JSON (`ficha`). Campos com ★ já existem na prévia de hoje (`previaSchema` em `painel-analise-preparo.ts`) ou no contrato (`dadosContratoSchema` em `painel-contrato.ts`) — CONFIRMADO. Os outros são **proposta** deste adendo, alinhada ao que o Felipe pediu e ao que o bot já extrai. Cada campo escalar leva `{ valor, fonte, trecho }` como a prévia atual, para a tela mostrar de onde veio.

```text
ficha
  versao                    "preliminar-v1"
  revisado                  bool          -- false até o atendente confirmar a revisão
  revisado_por / revisado_em
  interlocutor              -- quem fala no WhatsApp (Q3); pode NÃO ser locatário
    contact_id              uuid | null
    nome, celular
  candidatos[]              -- 1..N pretendentes / locatários
    papel                   locatario | solidario
    nome ★                  previa.candidato.nome
    cpf ★                   previa.candidato.cpf; na UI: ***.***.***-00
    email ★                 previa.candidato.email   -- Migra exige
    celular                 -- Migra e contrato
    nascimento, rg          -- contrato (dadosContratoSchema.pessoa.dados)
    profissao               -- contrato
    empregador              -- proposta (holerite / CTPS)
    endereco, numero, complemento, bairro, cep, cidade, uf
                            -- contrato
  fiadores[]                -- garantia = fiador; mesmo formato de candidato, sem renda
  renda                     -- regras da skill analise-financeira-inquilino
    mensal ★                previa.renda.mensal (depois das exclusões)
    proposta_fc             número que vai para a FC (pode diferir da soma)
    fontes[]                -- cada holerite / extrato / CTPS
      tipo ★                holerite | ctps | extrato | outro
      titular               quem recebeu
      empregador
      periodo ★
      valor_bruto
      valor_comprovado ★    depois de tirar autotransferência, poupança, Rende Fácil, PIX de terceiro
      trecho / fonte ★
    alertas[]               -- "PIX de terceiro ignorado", "poupança não conta", …
  imovel
    codigo_fc ★             regra do bot: 1ª palavra da rua + nº do apto
    logradouro ★, apartamento ★, complemento
    aluguel ★
    tipo                    residencial | comercial   -- contrato
  garantia
    tipo                    nenhuma | caucao | seguro_fianca | fiador   -- contrato
    caucao_valor
    seguradora_preferida    -- pista para a Migra; a cotação é que decide
  vigencia                  -- regra do bot: início = hoje+5d; fim = início+30 meses
    data_inicio, data_fim, prazo_meses
    dia_vencimento          -- contrato (o Hub tem padrão se vazio)
  documentos
    encontrados[]           { categoria, message_id?, file_name, mime, resumo }
                            -- identidade | renda | residência | estado_civil | outro
    faltantes[]             -- alimenta o botão de ficha cadastral (documentos_faltantes)
  pendencias[] ★            previa.pendencias
```

CPF: completo só no servidor, no momento de chamar Hub ou `/contrato/preparar`, e só depois de `revisado=true`. Na tela, `cpf_mascarado`. Logs e `audit()` sem CPF, sem nome, sem trecho de extrato.

---

### A.6c Mapeamento: ficha → FC, Migra, ficha cadastral, contrato

O Hub e o `/contrato/preparar` **não inventam campo**. O CRM projeta o registro revisado. Célula vazia = o destino não pede (ou o campo fica em branco para o atendente completar naquele passo). "INFERIDO" = lido nas skills do bot / neste adendo, sem o HTML do formulário da FC/Migra aberto.

| Campo da ficha | Ficha cadastral (MCP) | FC Score+ (Hub) | Migra (Hub) | `POST /contrato/preparar` (`dadosContratoSchema`) |
|---|---|---|---|---|
| `interlocutor.contact_id` | — | — | — | Não vai. O WhatsApp não é locatário por default (Q3). |
| `candidatos[].nome` | — | Nome do pretendente (INFERIDO) | Titular (INFERIDO) | `locatarios[].dados.nome` |
| `candidatos[].cpf` | — | CPF do pretendente (INFERIDO) | CPF (INFERIDO) | `locatarios[].cpf` (11 dígitos) |
| `candidatos[].email` | — | se o form pedir (NÃO MEDIDO) | **Obrigatório** (CONFIRMADO na prévia atual) | `locatarios[].dados.email` |
| `candidatos[].celular` | — | se o form pedir (NÃO MEDIDO) | **Obrigatório** (adendo A.2) | `locatarios[].dados.celular` |
| `candidatos[].nascimento` / `rg` / `profissao` / endereço | — | se o form pedir (NÃO MEDIDO) | NÃO MEDIDO | `locatarios[].dados.*` |
| `candidatos[].empregador` | — | pista de renda (INFERIDO) | — | não tem campo próprio; vai em `profissao` ou `observacao` se o atendente quiser |
| `candidatos[]` com `papel=solidario` | — | colocatário (INFERIDO) | **Solidário** (adendo A.2) | segundo `locatarios[]` (o schema de contrato não tem "solidário"; o Hub trata a lista) |
| `fiadores[]` | — | NÃO MEDIDO | NÃO MEDIDO | `fiadores[]` (mesmo `pessoa`) |
| `renda.proposta_fc` / `renda.mensal` | — | Renda informada (INFERIDO) | NÃO MEDIDO (a cotação usa o aluguel) | — |
| `renda.fontes[]` | comprovantes categoria `renda` | — | — | — |
| `imovel.codigo_fc` | — | **Cód. imóvel** (regra do bot, A.2) | NÃO MEDIDO | — |
| `imovel.logradouro` + `apartamento` + `complemento` | — | endereço (INFERIDO) | endereço (INFERIDO) | `imovel.endereco` / `numero` / `complemento` |
| `imovel.aluguel` | — | NÃO MEDIDO | valor da locação (INFERIDO) | `aluguel` |
| `imovel.tipo` | — | — | PF Residencial vs comercial (INFERIDO) | `tipo` |
| `garantia.tipo` | — | — | escolhe o produto (INFERIDO) | `garantia` |
| `garantia.caucao_valor` / `seguradora_preferida` | — | — | filtro de cards (INFERIDO) | `caucao_valor` / `seguradora_fianca` |
| `vigencia.data_inicio` / `data_fim` / `prazo_meses` | — | vigência (regra do bot: +5d / 30 meses) | vigência (INFERIDO) | `data_inicio` / `data_fim` / `prazo_meses` |
| `vigencia.dia_vencimento` | — | — | — | `dia_vencimento` |
| `documentos.encontrados[]` | lista de anexos já classificados | **não envia arquivo** (A.4) | **não envia arquivo** (A.4) | — |
| `documentos.faltantes[]` | `documentos_faltantes` do MCP de ficha | — | — | pendência na tela; contrato não bloqueia (Q10) |
| `pendencias[]` | texto do pedido no Composer | bloqueia **Gerar análise** se a ficha não estiver revisada | idem | campos vazios continuam obrigatórios no diálogo, como hoje |

O atendente pode editar qualquer célula na revisão. O que o Hub ou o contrato receberem é **a versão revisada**, nunca o JSON cru da IA.

---

### A.7 Fases pequenas e reversíveis

| Fase | O que entra | Como desfazer | Esforço estimado |
|---|---|---|---|
| **A0. Teste de bancada** (sem código de produto) | **Autorizado** (00:21). Robô: Migra Analisar + FC só SALVAR. Regras: parar antes de qualquer passo pago da FC; zero cobrança; dados fictícios/teste (CPF real só se ele pedir); parar em sessão expirada / login / 2FA / captcha, sem contornar. Resultado **ainda não registrado**. | Nada a desfazer. | 1 sessão |
| **A1. Relatório preliminar + dados estruturados** | Só CRM: rota de IA (200 mensagens + anexos do PR #15) → 6 seções + JSON da § A.6b → tela de revisão/edição (CPF mascarado). Antes da Fase 3, vive só na sessão da prévia. Com a Fase 3, grava `ficha` + `relatorio_preliminar` e preenche participantes. | Chave `preliminar` desligada. | Médio |
| **A2. Status no Hub** | Ferramenta 1 (só leitura). Imagem nova com tag nova. Precisa existir antes de FC/Migra no CRM, para o painel não voar às cegas. | Voltar a tag anterior. | Pequeno |
| **A3. Botão "Analisar seguro-fiança"** | Hub: `acao=seguro` e a ferramenta 4 (print). CRM: projeta a ficha revisada, acompanha e mostra os cards. | Chave `seguro` desligada. O Hub mantém o padrão antigo. | Médio |
| **A4. Botão "Gerar análise" (FC)** | Hub: passo pago no mesmo pedido do clique, com lock por pretendente. CRM: projeta a ficha revisada, um clique (no máximo um "ok" na mesma tela), `audit()`. Sem segundo clique obrigatório. | Chave `fc` desligada. Sem o clique, ninguém cobra. | Médio |
| **A5. Manual assistido** | CRM: dados para copiar (vêm da ficha), links e upload de laudo e print, com leitura pelo Gemini. Aparece sozinho em `erro` ou `login_necessario`. | Chave `manual` desligada. | Pequeno/médio |
| **A6. Relatório completo** | CRM: as mesmas 6 seções, agora com score/restrições da FC e cards da Migra. Só lê blocos guardados. Guardar no processo exige a Fase 3 / 3b. | Chave `relatorio` desligada. | Médio |
| **A7. API oficial** (quando existir) | Troca o motor no Hub. O CRM não muda. **Hoje não há API** (decisão h); sem e-mail nosso. | Voltar para o Playwright. | Depende da API |

**Ordem vigente (decisão e — nossa, ele só usa quando o conjunto estiver pronto):** A0 → **A1** → A2 → A3 → A4 → A5 → **A6**. O Relatório preliminar vem primeiro. FC/Migra/status vêm depois, já alimentados pela ficha. O relatório completo fica no fim. A0 está **autorizado**; o resultado ainda não foi registrado.

**Dependências:**
- O **A1 pode andar já**, sobre o PR #15. Não espera Hub.
- A2 (status) não bloqueia o A1; bloqueia só o acompanhamento de A3/A4.
- Para **gravar** ficha e relatórios, A1 e A3–A6 precisam da Fase 3 (processo) e da 3b (bucket) — até lá, só tela.
- A3/A4 recusam rodar sem `ficha.revisado=true`.
- A0 não bloqueia A1. O primeiro caso do robô segue as regras da § decisões (zero cobrança, dados de teste, parar em login/2FA/captcha).

---

### A.8 Custos e riscos

**Custos por candidato (estimativa):**
- FC Score+: R$ 17,60 a R$ 25,30 por pretendente, conforme o plano. É o único custo relevante e sai no clique **Gerar análise** (decisão c).
- Migra: **R$ 0** na cotação (decisão d).
- Gemini: leitura de anexos (o PR #15 já gasta isso), mais o Relatório preliminar (200 mensagens + anexos + 6 seções + JSON) e, no fim, o relatório completo. São centavos, até poucos reais num extrato longo escaneado. Fica registrado em `llm_calls`.
- VPS: nada novo. O container já está de pé (23 MB parado, até 900 MB rodando).

| Risco | Chance | Efeito | Como reduzir |
|---|---|---|---|
| Termos de uso da FC/Migra proíbem automação | Média | Bloqueio da conta | **Aceito** pelo Felipe (decisão b). Manual assistido de reserva. API quando existir (hoje não há). |
| Captcha ou 2FA aparece no login | Baixa/média | O robô para | O job vai para `login_necessario`. A tela oferece o manual. |
| O site muda o layout | Média | Seletor quebra | Prints de auditoria. Teste de bancada (A0) **autorizado**; resultado ainda não registrado. |
| Sessão expirada | Alta | Atraso | Login automático já existe. A retomada também. |
| Cobrança em dobro da FC | Baixa | R$ perdido | Lock / idempotência **por pretendente**. O Hub recusa o mesmo ID-FC. `audit()`. Sem segundo clique — o primeiro já cobra. |
| IA erra a renda ou um campo da ficha (visão não é OCR financeiro) | Média | Dado errado na FC, na Migra ou no contrato | O atendente **revisa o registro inteiro** antes de qualquer passo. CPF mascarado. Trechos de evidência na tela. Conferência opcional com a soma do `renda.py`. |
| Vazamento de dado pessoal | Baixa | LGPD | Arquivos no CRM (Q7 fechada). Hub **5 dias**. Logs sem CPF. Bucket privado. Poda de 90 dias. Cascata LGPD (§4.6). |
| Memória da VPS (Chromium + WAHA + n8n) | Baixa | Lentidão | Um job por vez. Limite de 900 MB. |
| Automação nunca testada de verdade | Alta | Falha no 1º caso | A0 **autorizado** (regras: zero cobrança, dados de teste, parar em login/2FA/captcha). Resultado ainda não registrado. Bot segue em paralelo. |

---

### A.9 O que ainda está aberto

00:19 fechou b–e, h e i. 00:21 fechou **a** (arquivos no CRM), **f** (5 dias no Hub / 90 dias no CRM) e **autorizou o A0**.

**Só isto falta:** o **resultado do A0** — gravar aqui depois do teste (login, sessão, seletores, se parou antes do pago, se houve cobrança zero).

O resto da lista antiga (ponto de IA, preço exato da FC, janela de 200, A1 na tela antes da Fase 3) **não bloqueia**.

---

### A.10 API oficial — não enviar e-mail

**Decisão h (28/10):** o Felipe **já perguntou** à FC e à Migra. **Não existe API** ainda. Os rascunhos abaixo **não se usam** — ficam só como memória, para revisitar **quando** alguma das duas tiver API.

<details>
<summary>Rascunhos arquivados (não enviar)</summary>

**Para a FC ANALISE** (suporte `fcsuporte@fichacerta.com.br` ou comercial `fcanalise@fichacerta.com.br`)
Assunto: Acesso à API do FC Score+ para integração com nosso CRM
> Olá! Somos a Brisa Aluguéis, cliente da FC. Queremos integrar o FC Score+ (cadastro, processamento e laudo em PDF) ao nosso CRM interno, sem uso do painel web. Vocês oferecem API para clientes diretos (vimos o DEV FC PANEL e a menção a api.fichacertadigital.com.br)? Quais são os requisitos, o custo e a documentação? Obrigado!

**Para a MigraSeguros** (pelo canal de parceiros em migraseguros.com.br/integracoes)
Assunto: Token de API para cotação de seguro fiança (Multi Cálculo PF Residencial)
> Olá! Somos a Brisa Aluguéis, imobiliária parceira. Queremos cotar seguro fiança (Multi Cálculo PF Residencial) direto do nosso CRM pela API REST de vocês, só análise e cotação, sem contratação automática. Como obtemos o token e a documentação? Há algum custo? Obrigado!

</details>

---

### A.11 Trilha para o AGENTS.md

- O passo **primeiro e central** é o **Relatório preliminar** (A1): 200 mensagens + anexos → 6 seções + JSON da ficha. FC, Migra, ficha cadastral e `/contrato/preparar` **reutilizam a ficha revisada**, sem redigitar e sem reler a conversa.
- Arquivos **não** vão ao Hub (Q7 fechada, 00:21). O PR #15 lê extratos e fotos (CNH etc.) no CRM.
- Retenção: **5 dias** no Hub, **90 dias** no CRM.
- Playwright na FC/Migra: risco de termos **aceito**. Bot Análise De Inquilinos **segue em paralelo**. Sem e-mail de API — não existe ainda.
- **Gerar análise** no CRM **é** a autorização da cobrança da FC. Sem segundo clique obrigatório. **Lock / idempotência por pretendente** contra cobrança em dobro. "Contratar" da Migra nunca aparece. Cotação Migra = R$ 0.
- O relatório **completo** usa **só** os blocos guardados (`relatorio_preliminar`, `ficha`, `seguro`, `fc`), nunca a conversa crua.
- Cada botão tem uma chave própria em `organizations.settings.locacao.analise` (`preliminar`, `seguro`, `fc`, `relatorio`, `manual`).
- CPF mascarado na UI; logs e auditoria sem CPF, nome, bytes ou texto de extrato.
- A0 **autorizado** (zero cobrança, dados de teste, parar em login/2FA/captcha). **Ainda aberto:** o resultado do teste.
