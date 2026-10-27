# Plano: processo de locação (Inbox → análise → contrato)

**Status:** rascunho para o Felipe validar. **Nenhuma linha de produto foi alterada neste PR.**
**Âncora medida:** `origin/main` do fork `felpzGondim/DeskcommCRM` em `905b1027c` (tag `v1.88.0-felpz.5`, 27/10/2026).
**Destino proposto:** fork da Brisa (não sobe para o DeskcommCRM original). As peças do painel já existentes continuam como consumidor opcional do servidor MCP externo.

Este arquivo é a trilha para a próxima sessão de implementação. Depois que o Felipe responder as perguntas da §8, a implementação começa pela Fase 1 — e só pela Fase 1.

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
| 7 | Chamado de manutenção | — | **Não existe** |

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
| **3 — Processo de locação** | Uma ficha por contato + imóvel, reaproveitada no contrato; link `superlogica_pessoa_id` no contato | Este repo (banco + API + tela) |
| **3b — Documentos organizados** | Pasta por processo no Storage; ao fechar contrato, arquivo no Drive da Brisa; o que não vira contrato some em 90 dias | Este repo (Storage + poda) + **n8n na VPS** (Drive e backup) |
| **4 — Painel de análise** | Quatro botões: Analisar renda, Analisar FC, Analisar seguro-fiança, Gerar relatório. Pré-preenchidos, editáveis, com andamento do job | Este repo (tela) + Hub (jobs e confirmação cobrada) |
| **5 — Contrato pré-preenchido** | Gerar contrato nasce da ficha aprovada; no sucesso, grava os IDs do SuperLógica | Este repo + Hub (já cria a locação) |

**Regras que não mudam em fase nenhuma:**

- SuperLógica é a verdade. O CRM **não copia** contrato, boleto nem cadastro — só guarda um número de ligação (`id_pessoa_pes`, `id_contrato`) e o que o atendente conferiu neste processo.
- Toda escrita no SuperLógica e toda mensagem ao cliente exigem **clique explícito** do atendente. A IA nunca envia e nunca grava locação sozinha.
- Tudo versionado, com documento de decisão, para outra IA continuar sem adivinhar.

**O que este PR pede de você:** ler a §1 e a §8 (perguntas abertas), marcar sim/não/escolha, e só então autorizar a Fase 1.

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

Não há ferramenta, rota nem botão. Fora do escopo das Fases 1–5, a menos que o Felipe peça para encaixar. A §8 pergunta se entra depois da Fase 5 ou em paralelo.

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
                    │ processo de locação (Postgres + RLS)    │
                    │ documentos (Storage privado)            │
                    │ contacts.superlogica_pessoa_id (link)   │
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
4. Relatório agrupado é conferido e marcado como aprovado no processo.
5. **Gerar contrato** abre já preenchido (Fase 5). Atendente confere a prévia do Hub e confirma. SuperLógica cria a locação ATIVA.
6. CRM grava `superlogica_pessoa_id` no contato e o `id_contrato` no processo. Emite evento. n8n arquiva a pasta no Drive e no disco. Processo que **não** virou contrato some do Storage e do banco após 90 dias.

Laço de retorno (Sistema Vivo, invariante 7): se a criação falhar, a mesma prévia retoma o mesmo pedido (já existe). Se a análise cobrada falhar, o job do Hub fica visível no painel e o processo não avança de status. Se o n8n falhar o arquivo, o processo **não** é podado (status `contrato_criado` + `arquivo_drive` pendente) e a Central ganha um aviso.

---

## 4. Modelo de dados (Fase 3 / 3b — não criar agora)

Nada disto entra antes da Fase 1 estar verde na VPS. A numeração `NNNN` livre na `main` deste fork, hoje, é **0762** em diante — na hora de implementar, rodar `pnpm checar:colisao-de-migration` de novo. Tripla obrigatória: arquivo em `supabase/migrations/` com `-- manifest:` + apêndice idempotente no `supabase/baseline.sql`. **Não** editar `MANIFEST.md`.

### 4.1 Coluna no contato (sem tabela extra)

```sql
-- em public.contacts
alter table public.contacts
  add column if not exists superlogica_pessoa_id text;

comment on column public.contacts.superlogica_pessoa_id is
  'id_pessoa_pes no SuperLógica. Só o identificador; o cadastro mora no ERP.';
```

Por que **não** uma tabela `contact_superlogica_pessoas`:

- Um WhatsApp da Brisa é, no fluxo comum, **uma** pessoa no SuperLógica.
- Locatário extra e fiador **não precisam** ser contato do CRM: vivem no processo (§4.2).
- Tabela de ligação só se justificaria se o mesmo contato tivesse vários `id_pessoa_pes` estáveis (casal no mesmo número, procurador). Isso é pergunta 8.3. Se a resposta for “casal no mesmo WhatsApp é comum”, aí sim uma tabela filha `contact_id + superlogica_pessoa_id + papel` — não agora.

Índice: `(organization_id, superlogica_pessoa_id)` onde o valor não é nulo. Sem unique global: o mesmo id de pessoa pode, em teoria, aparecer em outra organização deste fork? Na Brisa há uma org só; ainda assim o índice leva `organization_id` por doutrina. Unique **por organização** faz sentido (um `id_pessoa_pes` ↔ um contato). Se o Felipe confirmar um-para-um, a unique entra.

LGPD: a cascata `fn_lgpd_cascade_redact_contact` (e a varredura diária) **zera** esta coluna no mesmo passo que zera `cpf_encrypted`. O export do titular inclui o id (é dado pessoal de ligação).

Não gravar nome, CPF, endereço nem contrato do SuperLógica nesta coluna.

### 4.2 Entidade `locacao_processos`

Uma linha = um processo de locação = **um contato + um imóvel**. Candidatos extras e fiadores são JSON conferido pelo atendente, não cópia do ERP.

```text
public.locacao_processos
  id                         uuid pk
  organization_id            uuid not null → organizations on delete cascade
  contact_id                 uuid not null → contacts on delete restrict
  conversation_id            uuid null → conversations on delete set null

  -- imóvel (chave de negócio; SuperLógica continua a fonte)
  imovel_codigo_fc           text null
  imovel_endereco            text null          -- o que o atendente conferiu
  imovel_identidade          text not null      -- canônico: codigo_fc ou endereço normalizado
                                                -- unique (organization_id, contact_id, imovel_identidade)

  status                     text not null      -- ver vocabulário abaixo
  -- dados conferidos (não são o ERP)
  candidatos                 jsonb not null default '[]'
  fiadores                   jsonb not null default '[]'
  renda                      jsonb not null default '{}'
  resultado_fc               jsonb not null default '{}'
  cotacao_seguro             jsonb not null default '{}'
  relatorio                  jsonb not null default '{}'

  superlogica_contrato_id    text null          -- só o link, depois da Fase 5
  arquivo_drive_url          text null          -- preenchido pelo n8n
  arquivo_vps_path           text null

  aprovado_por               uuid null → auth.users
  aprovado_em                timestamptz null
  created_by                 uuid null → auth.users
  created_at                 timestamptz not null default now()
  updated_at                 timestamptz not null default now()
```

Vocabulário de `status` (text + CHECK, doutrina do repo):

`rascunho` → `documentos` → `renda_conferida` → `fc_pendente` → `fc_pronta` → `seguro_pendente` → `seguro_pronto` → `relatorio_pronto` → `aprovado` → `contrato_criado` → `arquivado`  
Saídas laterais: `recusado`, `expirado` (poda).

`candidatos` / `fiadores` (formato, não coluna solta):

```json
[{ "papel": "locatario", "nome": "...", "cpf_mascarado": "***", "email": "...",
   "superlogica_pessoa_id": null, "contact_id": null }]
```

CPF completo **não** mora em claro no JSON. Se o contrato precisar do CPF de novo, o atendente confirma na prévia do Hub (o Hub já busca pelo CPF informado no formulário). Alternativa, se o Felipe quiser persistir CPF de fiador que não é contato: usar o mesmo par `cpf_encrypted` + `cpf_hash` numa tabela filha — pergunta 8.4.

DIRC, para não nascer coluna morta:

| Dado | Decisão |
|---|---|
| Nome/e-mail do candidato principal | Referência: `contacts` + o que o atendente editou no processo |
| Cadastro SuperLógica | Referência: `superlogica_pessoa_id` / `superlogica_contrato_id` |
| Boletos, situação do contrato | Calcular: consultar o Hub na hora |
| Renda / FC / seguro / relatório | Duplicar **o conferido**, com `fonte` e `trecho`, porque o Hub não é ficha e o atendente não pode redigitar |
| Bytes do RG | Referência: caminho no Storage |

### 4.3 Documentos do processo

Espelha o padrão já aceito de `crm_lead_attachments` (migration 0731): linha no banco + binário no Storage, caminho imutável, check no próprio path.

```text
public.locacao_processo_documentos
  id, organization_id, processo_id
  categoria          text not null
                     -- identidade | renda | fc | seguro | relatorio | outro
  origem             text not null  -- conversa | upload_atendente | hub
  message_id         uuid null → messages
  file_name, mime_type, file_size
  storage_path       text not null  -- ver §4.4
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

### 4.4 Storage

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

### 4.5 RLS, auditoria, retenção, LGPD

- RLS: `tenant_isolation_locacao_processos_all` e a irmã dos documentos, via `fn_user_org_ids()`. Leitura `agent+`; escrita `agent+` nas rotas, com `requireSupportWrite` antes do efeito.
- Handler com admin client **filtra `organization_id` da sessão**, nunca do body.
- Mutação bem-sucedida → `audit()` (`locacao.processo_criado`, `locacao.analise_salva`, `locacao.contrato_vinculado`, `locacao.arquivado`, `locacao.expurgado`). Sem CPF, sem bytes, sem resumo da ficha.
- Poda: função `fn_expurgar_processos_de_locacao_vencidos` (`security definer`, **piso de 90 dias no corpo**, `revoke` de `public` e `anon`). Apaga só status `rascunho` / `documentos` / `recusado` / `expirado` **sem** `superlogica_contrato_id`. Enfileira os paths do Storage. Chamada em lotes pelo cron `data-retention` (padrão das irmãs em `lib/retencao/politica.ts`). Processo `contrato_criado` sem `arquivo_drive_url` **não** é podado — o n8n ainda deve.
- Cascata LGPD: incluir as duas tabelas + os objetos do bucket em `fn_lgpd_cascade_redact_contact` e no export. Anonimizar o contato anonimiza o processo (nomes viram `Cliente Anonimizado #N`; arquivos saem do Storage).
- Invariante de isolamento (2 orgs) é obrigatório no `pnpm test:db` antes do merge da Fase 3.

### 4.6 O que deliberadamente **não** entra no banco

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

### Fase 3 — Processo no banco e link SuperLógica

**Objetivo:** o atendente não redigita. Existe um processo por contato+imóvel; o contato pode carregar `superlogica_pessoa_id`.

#### 3.A — DeskcommCRM

- Migration + baseline + `-- manifest:` com o modelo da §4 (sem o bucket ainda, se quiser fatiar; o mais barato é 3+3b juntos — pergunta 8.8).
- Regenerar `lib/database.types.ts` pelo fluxo do repo.
- API ` /api/v1/locacao/processos` (lista/cria/atualiza) com Zod, `requireRole("agent")`, `requireSupportWrite` em mutação, `organization_id` da sessão, `ok()`/`fail()`, idempotência no POST (`Idempotency-Key`), rate limit do painel.
- Entrada em `lib/auth/public-paths.ts` **somente** se a rota aceitar bearer — no início, cookie basta.
- UI: no Painel, um bloco “Processo desta conversa” (status + imóvel + último salvamento). Criar na primeira análise ou no primeiro “salvar”.
- Cascata LGPD + export + invariante de isolamento.
- Fragmento `.changes/` (`capacidade_nova`): o operador da VPS passa a ter uma ficha que sobrevive à troca de conversa.
- Destino: **fork / nicho**. Não abrir PR no `melgarafael/DeskcommCRM`.

#### 3.B — brisa-hub

- Nada obrigatório. Se `consultar_contrato_inquilino` já devolve `id_pessoa_pes`, o CRM pode gravar o link na consulta (ainda é leitura + um update local, com o atendente ciente — pergunta 8.9).

#### Aceite da Fase 3

- [ ] Dois tenants: processo da org A invisível na org B (`pnpm test:db`).
- [ ] Trocar de conversa e voltar: a ficha está lá.
- [ ] Anonimizar o contato zera `superlogica_pessoa_id` e redige o processo.
- [ ] Sem `superlogica_pessoa_id` a Inbox continua útil.
- [ ] Nenhuma tabela espelha contrato/boleto.

#### Teste da Fase 3

- Invariantes: RLS, CHECK de status, unique (org, contato, imóvel), cascata LGPD.
- Unitário das rotas (org no filtro, suporte só leitura, Zod).
- E2E: criar processo pela tela, recarregar, ver o status.

---

### Fase 3b — Documentos no Storage, Drive e poda

**Objetivo:** cada anexo classificado mora numa pasta do processo. Contrato fechado → Drive da Brisa + backup na VPS. Processo morto → some em 90 dias.

#### 3b.A — DeskcommCRM

- Bucket `locacao-processos` + tabela `locacao_processo_documentos` (§4.3–4.4).
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
- A IA **não** clica no passo pago.

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

#### Teste da Fase 4

- Unitário de UI (quatro botões, checkbox, polling).
- Rota: não chama Hub no salvar local; chama no confirmar pago.
- Par: o mesmo pedido de FC pela tela e pela ferramenta do Hub.

---

### Fase 5 — Gerar contrato a partir do processo aprovado

**Objetivo:** o diálogo atual nasce preenchido. No sucesso, o CRM guarda os links e dispara o arquivo.

#### 5.A — DeskcommCRM

- `GerarContratoDialog` recebe o processo aprovado e mapeia `candidatos` / `fiadores` / imóvel / aluguel / garantia / seguro para `DadosContrato`. Campos que o Hub exige e o processo não tem ficam vazios, obrigatórios como hoje.
- Só habilita “Preparar” se `status` ∈ (`aprovado`, `relatorio_pronto`) — ou o Felipe autoriza preparar antes (8.10).
- No `gravado: true`: UPDATE do processo (`superlogica_contrato_id`, `status=contrato_criado`); UPDATE de `contacts.superlogica_pessoa_id` se o Hub mandar `id_pessoa_pes` (e se o contato ainda não tiver, ou se for o mesmo). Não sobrescrever um id diferente sem o atendente confirmar (casal / pessoa errada).
- Emite `locacao.contrato_arquivar` para o n8n.
- Auditoria já existente + a nova, sem PII.

#### 5.B — brisa-hub

- `confirmar` devolve `id_contrato`, `situacao`, `id_pessoa_pes` (lista se houver vários locatários).
- Continua criando ATIVO, despesas, idempotência.

#### Aceite da Fase 5

- [ ] Abrir Gerar contrato numa conversa com processo aprovado: endereço, aluguel, CPF do locatário já estão lá.
- [ ] Confirmar grava os dois links e muda o status.
- [ ] Segunda confirmação da mesma prévia não cria segundo contrato nem segundo UPDATE conflitante.
- [ ] Processo de outro contato não pré-preenche.

#### Teste da Fase 5

- Unitário do mapeamento processo → `DadosContrato`.
- Rota: sucesso grava ids; Hub sem `id_pessoa_pes` não inventa; id diferente pede confirmação.
- Homolog: um contrato de teste, depois o n8n da 3b.

---

## 6. Ordem sugerida

```
Fase 1  (operação + Hub)     ── sem isto, o resto é teatro
   │
Fase 2  (ler anexos)         ── pode começar o desenho no CRM em paralelo
   │                            à publicação do Hub, mas o aceite precisa dos dois
   │
Fase 3  (processo + link)    ── desbloqueia 3b, 4 e 5
   │
   ├─ Fase 3b (Storage + n8n) ── pode ir em paralelo com a 4
   │
   └─ Fase 4 (quatro botões) ── precisa do GET de job no Hub
          │
        Fase 5 (contrato pré-preenchido + ids)
```

O botão 7 (manutenção) fica **depois** da Fase 5, salvo resposta da 8.11.

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
| Casal no mesmo WhatsApp | Um `superlogica_pessoa_id` no contato não basta | 8.3; até lá, o segundo locatário vive só no JSON do processo |
| Subir isso no Deskcomm original | Tabela de locação não serve clínica nem loja | Destino = fork. Núcleo só o consumidor MCP que já está |
| `brisa-hub` inacessível para a IA | Este plano pode ter errado o contrato do Hub | 8.2; o outro bot confirma OpenAPI antes de implementar 2 e 4 |

---

## 8. Perguntas para o Felipe (responda aqui ou no PR)

Resposta curta basta. Sem resposta, a implementação **não inventa**.

1. **URL do contrato.** Se o MCP for `https://hub/brisa/mcp` e o contrato for outro host, autoriza um campo “URL da API de contratos” no cadastro MCP? Ou o Hub garante o mesmo host e o sufixo `/contrato/{etapa}`?
2. **Estado real do Hub.** O PR #22 (ou sucessor) já está deployado na VPS? O teste de conexão hoje lista quais ferramentas? (Cole a lista.)
3. **Um WhatsApp, várias pessoas.** Casal ou fiador no mesmo número: um `superlogica_pessoa_id` no contato basta, e os outros ficam só no processo?
4. **CPF de quem não é contato.** Fiador sem WhatsApp: o CRM guarda CPF cifrado no processo, ou o atendente redigita só na hora do contrato?
5. **Teto de OCR.** Quantas páginas / quantos MB por PDF escaneado? Proposta: 8 páginas ou 8 MB, o que vier primeiro.
6. **Conversa longa.** Proposta: até 80 mensagens “úteis” (anexo ou dado cadastral) **ou** 400 brutas, e 60 mil caracteres no bloco. Serve?
7. **Como o arquivo chega no Hub.** URL assinada (mais simples) ou upload multipart (se o Hub não puder baixar o Storage)?
8. **Fase 3 e 3b juntas** num PR, ou o banco primeiro e o bucket depois?
9. **Gravar `superlogica_pessoa_id` já na consulta** de contrato (leitura), ou só depois de **criar** o contrato (Fase 5)?
10. **Gerar contrato só com processo aprovado**, ou o atendente pode abrir o formulário vazio como hoje, sem processo?
11. **Chamado de manutenção** (botão 7): depois da Fase 5, em paralelo, ou fora deste plano?
12. **Pasta do Drive.** Confirma o padrão `Brisa Aluguéis / {endereço ou código do imóvel} / {id do contrato}/`? Quem cria a pasta-mãe se não existir — o n8n?
13. **Backup na VPS.** Caminho `/var/brisa/arquivo-contratos/{id_contrato}/` serve? Por quanto tempo o disco local guarda, além do Drive?
14. **Passo pago além da FC.** Seguro-fiança (Migra) também exige o segundo clique, sempre, ou só quando o Hub disser que vai cobrar?
15. **Destino.** Confirma que tabelas de processo **não** vão para o repositório original (`melgarafael/DeskcommCRM`), só para este fork?

---

## 9. Trilha para a próxima IA (AGENTS-style)

Antes de escrever código:

1. Ler este arquivo inteiro e as respostas do Felipe na §8 (comentário do PR ou emenda neste arquivo).
2. Ler [`docs/decisoes/painel-agente.md`](../decisoes/painel-agente.md) e [`docs/decisoes/painel-acoes-hub.md`](../decisoes/painel-acoes-hub.md). Se a fase mudar comportamento, **emendar** esses dois — não criar uma terceira verdade.
3. Rodar `bash .agents/skills/deskcomm-contribuir/scripts/quem-sou.sh` e `git fetch origin main`. Branch nova a partir de `origin/main`, nome `cursor/<fase>-5267` (ou o sufixo da sessão).
4. **Uma fase por PR.** Fase 1 sem schema. Fase 3 com tripla de migration. Não editar migration já aplicada.
5. `organization_id` da sessão. `requireSupportWrite` em mutação. Sem `getSession()`. Sem `console.log`. Sem marca “Deskcomm” na UI.
6. SuperLógica só via Hub. Sem tabela espelho. Sem mensagem ao cliente sem o atendente clicar em enviar.
7. Ao fechar a fase: atualizar a tabela da §1 (“Pronto para usar?”), anexar evidência, listar **O que NÃO medi**.
8. Living System Checklist da peça nova (entrada, saída, audit, tela, porta, anti-morte, laço). Mapa em `docs/architecture/` com ≥2 arestas.
9. Destino = fork. Não abrir PR upstream.

Contrato que o CRM já exige do Hub (não reinventar nomes): `lib/agent-engine/agent/painel-acoes-hub.ts` e `lib/agent-engine/agent/painel-contrato.ts`.

---

## 10. O que este plano NÃO mediu

- O repositório `felpzGondim/brisa-hub` (404 neste ambiente). OpenAPI, variáveis reais da VPS, se o PR #22 mergeou, se o `brisa-analise` já aceita arquivo: **NÃO MEDIDO**.
- Se a instalação de produção (`v1.88.0-felpz.5`) já puxou a imagem que contém o PR #8. A tag aponta para `905b1027c`, que inclui o merge — o `update.sh` da VPS é passo do Felipe.
- SuperLógica de homologação (campos obrigatórios além dos que o diálogo já pede).
- Cota atual do Storage e do Drive da Brisa.
- Se o n8n da VPS já tem credencial do Google Drive.
- Playwright real de FC/Migra (custo, seletor, lock).
- O botão 7 e qualquer fluxo de manutenção.

Fim do rascunho. A implementação espera as respostas da §8 e o “pode ir a Fase 1”.
