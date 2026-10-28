# Fase 3b: arquivos do processo de locação (Supabase Storage + pasta permanente no Google Drive)

**Situação:** só plano. **Nada foi aplicado.** Toda escrita no banco, no código, no servidor ou no Drive precisa do ok explícito do Felipe.
**Feito em:** 28/10/2026, perto de 01:40 (horário de Brasília).
**Decisão do Felipe (28/10, 01:10):** "Pode fazer supabase e quando virar contrato pasta no Googledrive, que não é excluída".
**Liga com:** Fase 3 (`fase3-processo-locacao.md`, §5 e P8), Fase 3.5 (vínculo com a Superlógica), adendo de análise do inquilino. (A pendência de segurança das funções SECURITY DEFINER está em aberto por decisão do Felipe, 28/10 01:19.)
Sem dado pessoal neste arquivo.

---

## 1. A ideia em 4 frases

1. Os anexos da conversa que entram na análise (RG, comprovante de renda, laudo FC, cotação do seguro, relatório) são **copiados** para um bucket **privado** do Supabase, `locacao-processos`, separados por empresa e por processo.
2. Se o processo **não** vira contrato, esses arquivos somem do CRM **90 dias** depois que o processo termina.
3. Se **vira contrato**, o CRM copia os arquivos para uma pasta do **Google Drive** que **nunca é apagada**, e também para o **backup da VPS**.
4. Nada é apagado do CRM sem antes conferir que a cópia no Drive e na VPS está inteira.

## 2. O que já existe (levantado só com leitura)

- **Buckets atuais:** 9, todos privados menos `brand-logos`. Os anexos do WhatsApp ficam em `whatsapp-media` (privado, até 50 MB). O `locacao-processos` ainda **não** existe.
- **O CRM não fala com o Google Drive hoje.** Ele usa o Google só para agenda, Meet e Ads.
- **Backup da VPS:** já existe o `brisa-backup.sh`, que roda às 03:00 (Brasília).
  - É cifrado (restic), vai para o Google Drive pelo rclone e guarda as últimas 7 noites.
  - Hoje **não** inclui nada do CRM além dos volumes do WAHA e do Caddy.
  - O Supabase Storage fica fora dele.
- **Hub:** o job da análise e os arquivos dele somem em **5 dias** (já implementado). A 3b não muda isso.
- **Conta de serviço do Google:** uma chave de conta de serviço ficou exposta antes no box. **Ela tem que ser revogada e trocada antes de qualquer uso** (passo B1). Este plano não lê nem usa essa chave.

## 3. Parte 1: Supabase Storage (enquanto o processo anda)

### 3.1 Bucket
- Nome `locacao-processos`, **privado**.
- Limite de 20 MB por arquivo.
- Tipos aceitos: PDF, JPEG, PNG, WEBP e HEIC.
- Caminho (o mesmo da Fase 3): `{org_id}/processos/{processo_id}/{categoria}/{documento_id}.{ext}`.
  - Categorias: `documento_pessoal`, `comprovante_renda`, `laudo_fc`, `cotacao_seguro`, `relatorio`, `contrato`, `outro`.
  - **O caminho não leva nome, CPF nem telefone.**

### 3.2 Regras de acesso (RLS no `storage.objects`)
- **Ler:** só quem é da org do 1º pedaço do caminho (`fn_user_org_ids()`), seguindo o padrão do `crm_lead_attachments`.
- **Gravar:** membros da org, com `fn_support_storage_write_allowed` para o modo suporte.
- **Apagar:** ninguém pela sessão do usuário. Só o servidor (service role), pela rotina de 90 dias ou pela LGPD.
  - O botão "remover documento" só marca `removido_em` e esconde o arquivo; quem apaga de verdade é a rotina.
- **Download:** link assinado de 15 minutos, gerado pelo servidor.
- **Sem função SECURITY DEFINER nova chamável por usuário logado:** as funções novas da 3b são SECURITY INVOKER, ou só o servidor (service role) pode chamá-las.

### 3.3 Tabela `locacao_processo_documentos` (Fase 3, P8)
| Campo | Para quê |
|---|---|
| `id`, `organization_id`, `processo_id`, `participante_id` (opcional) | De quem é |
| `categoria`, `storage_path`, `mime`, `tamanho_bytes`, `sha256`, `md5` | O arquivo e a "impressão digital" dele (para conferir cópias) |
| `origem` (`anexo_conversa`, `upload_manual`, `hub_fc`, `hub_migra`, `relatorio`) e `mensagem_id` | De onde veio |
| `drive_status` (`nao_se_aplica`, `pendente`, `copiado`, `falhou`), `drive_file_id`, `drive_copiado_em`, `drive_md5` | Cópia no Drive |
| `vps_status`, `vps_sha256`, `vps_copiado_em` | Cópia na VPS |
| `removido_em`, `removido_por`, `motivo_remocao` | Remoção lógica |
| `created_at`, `created_by` | Quando e quem |

### 3.4 Como o anexo da conversa entra
- No painel do processo, o atendente marca "usar na análise" num anexo da conversa. Ou a análise (Fase 2/A.6) usa o anexo e o servidor pergunta "guardar no processo?".
- O servidor **copia** o objeto de `whatsapp-media` para `locacao-processos`, calcula o `sha256` e o `md5` e grava a linha.
- O original da conversa fica onde está, com a regra dele.

## 4. Parte 2: Google Drive (quando vira contrato)

### 4.1 Quando copiar
- Começa quando o processo chega a `contrato_criado` (já tem o id do contrato da Superlógica).
- Documentos novos, como o contrato assinado, continuam sendo copiados até 30 dias depois de `contrato_assinado`.
- Processos que não viram contrato **nunca** vão para o Drive.

### 4.2 Estrutura de pastas
```
Contratos Brisa/                                  ← pasta raiz, criada à mão pelo Felipe
  {código do imóvel} - {endereço curto}/          ← uma por imóvel
    {AAAA-MM} - contrato {id Superlógica}/        ← uma por contrato
      01 Documentos pessoais/
      02 Comprovantes de renda/
      03 Análise FC/
      04 Seguro fiança/
      05 Relatório/
      06 Contrato/
      07 Outros/
      LEIAME.txt   ← lista dos arquivos com data, categoria, papel e sha256; sem CPF
```
- **Nome do arquivo:** `{categoria}-{papel}-{AAAAMMDD}-{6 letras do id}.{ext}`. Exemplo: `renda-locatario1-20261028-a1b2c3.pdf`.
- O nome usa o **papel** (locatário 1, fiador 1), não o nome da pessoa. Quem quiser saber de quem é, abre o processo no CRM ou o LEIAME. (Pergunta 4.)
- Cada pasta e cada arquivo leva uma marca invisível do Drive (`appProperties`) com o id do processo e do documento. É ela que evita duplicar (§4.5).

### 4.3 Como o CRM entra no Drive (conta de serviço × OAuth)
| | (a) Conta de serviço + Drive compartilhado (recomendado, se a Brisa tiver Google Workspace) | (b) OAuth de uma conta da Brisa |
|---|---|---|
| Como funciona | Um "robô" do Google, sem senha de pessoa, é membro de um **Drive compartilhado** "Contratos Brisa" com o papel **Colaborador** | O CRM guarda um token de acesso de uma conta Google da Brisa, com permissão `drive.file` (só os arquivos que ele mesmo cria) |
| "Nunca é apagada" | **Garantido pelo Google:** no Drive compartilhado, Colaborador cria e edita, mas **não consegue mandar para a lixeira**. Só o dono (Felipe) apaga. | Garantido só pelo nosso código: o token **conseguiria** apagar o que criou. |
| Espaço | O do Drive compartilhado (do Workspace) | O da conta |
| Se a pessoa sair ou trocar senha | Não afeta | O token pode cair e a cópia para até alguém reconectar |
| Requisito | Google Workspace (conta de serviço não tem espaço próprio no "Meu Drive") | Qualquer conta Google |
| Segredo | Chave **nova** (a exposta é apagada antes) | Token de atualização |

O segredo fica guardado no `.env` do CRM na VPS (permissão 600) ou nos secrets do Supabase. **Nunca** vai para o Git, para log, para o store ou para arquivo .md.

### 4.4 Qual conta do Drive
- **Recomendado:** a conta da Brisa (a mesma ligada ao conector "brisa-alugu-is"), como dona do Drive compartilhado. O Felipe fica como administrador.
- Ninguém recebe link "qualquer pessoa com o link".
- O backup da VPS já usa um destino no Drive (`brisa-backup-vps`). A pasta de contratos fica **separada** dele.

### 4.5 Como a cópia funciona, com falhas e novas tentativas
- **Fila:** quando um documento precisa ir para o Drive, ele fica `drive_status = pendente`.
- **Quem copia:** um cron do CRM, no mesmo padrão do `event-log-drain`, que já roda a cada minuto. Ele pega até 10 pendentes por vez.
- **Sem duplicar:** antes de enviar, procura na pasta um arquivo com a marca daquele documento. Se achar, só confere e marca `copiado`. As pastas usam a mesma regra.
- **Arquivo grande:** envio em partes (upload retomável) acima de 5 MB.
- **Conferência na hora:** depois do envio, lê de volta do Drive o `md5Checksum` e o tamanho e compara com os do CRM. Se for diferente, conta como falha.
- **Novas tentativas:** espera 1 min, 5 min, 30 min, 2 h, 6 h e 12 h (até 8 tentativas, cerca de 1 dia).
  - Erro de cota ou de "muitos pedidos" (403/429) também espera.
  - Erro de credencial (401) pausa a fila inteira e avisa na hora.
- **Desistência:** depois da 8ª, fica `falhou`, aparece um selo vermelho no processo ("cópia no Drive falhou") e o Felipe recebe um aviso.
  - Um botão "tentar de novo" (só Felipe) volta para `pendente`.
- **Log:** só ids, categoria, status e código do erro. Nunca nome, CPF ou conteúdo.

## 5. Parte 3: backup na VPS

- Toda noite, antes do `brisa-backup.sh`, um script baixa da `locacao-processos` os documentos de processos **com contrato** que ainda não estão na VPS.
  - Destino: `/opt/brisa-docs/contratos/{org}/{processo}/…`, com pasta 700 e arquivos 600.
  - Confere o `sha256` e marca `vps_status = copiado`.
- Esse caminho entra na lista do `brisa-backup.sh`, que já cifra tudo e manda para o Drive.
- Resultado: o contrato fica em 3 lugares — Drive (permanente), disco da VPS e backup cifrado das últimas 7 noites.
- **Espaço:** dá para estimar quando houver uso. Um contrato com documentos tem uns 10 a 30 MB.

## 6. Retenção (regras que continuam valendo)

| Onde | Processo **sem** contrato | Processo **com** contrato |
|---|---|---|
| Hub | 5 dias (já é assim) | 5 dias |
| CRM (`locacao-processos`) | Apaga **90 dias** depois do fim do processo (`encerrado_em`: reprovado ou cancelado) | Apaga 90 dias depois de `contrato_assinado`, **só se** a conferência do §7 passar (pergunta 6) |
| Google Drive | Nunca vai | **Nunca apagado** pelo sistema |
| VPS (`/opt/brisa-docs`) | Nunca vai | Fica (pergunta 7) |
| Original na conversa (`whatsapp-media`) | Regra atual do CRM | Regra atual do CRM |

A rotina de 90 dias é a `fn_expurgar_processos_de_locacao_vencidos` da Fase 3 (P7). A 3b só acrescenta a parte dos arquivos e a conferência.

## 7. Conferência antes de apagar qualquer coisa do CRM

Para cada documento de um processo **com contrato**, a rotina só apaga do bucket se **tudo** isto for verdade:
1. `drive_status = copiado` e o arquivo existe no Drive (busca pelo `drive_file_id`), **não está na lixeira**, e o `md5Checksum` e o tamanho batem com os do CRM.
2. O arquivo aparece na listagem da pasta certa do contrato.
3. `vps_status = copiado`, o arquivo existe em `/opt/brisa-docs` com o mesmo `sha256`, e o último backup noturno deu certo há menos de 48 h.

Se **qualquer** item falhar, o processo inteiro fica para depois, ganha o selo "conferência falhou" e o Felipe é avisado. Nada é apagado.

- Processos **sem** contrato não têm cópia para conferir: apagam aos 90 dias, como manda a regra.
- **Modo simulado primeiro:** nas 2 primeiras semanas, a rotina só escreve "apagaria N arquivos de M processos" e não apaga nada.

## 8. LGPD

- **Base legal:**
  - na análise: procedimentos pré-contratuais e proteção do crédito;
  - no contrato: execução do contrato, cumprimento de obrigação legal e defesa em processo (LGPD, art. 7º, incisos II, V, VI e X; art. 16 para guardar depois do fim).
- **"Nunca apagado" e a LGPD:** a lei pede apagar quando a finalidade acaba, mas permite guardar para obrigação legal ou defesa de direitos.
  - Recomendo **não** apagar nada automaticamente.
  - Uma vez por ano, o CRM gera para o Felipe uma lista dos contratos encerrados há mais de 5 anos, para ele decidir caso a caso (pergunta 8).
- **Pedido de exclusão de um contato:**
  - no CRM, a limpeza da Fase 3 (§5.3) apaga os documentos dele no bucket;
  - **no Drive e na VPS, nada é apagado sozinho.** O sistema cria uma pendência "pedido LGPD de pessoa com contrato no Drive" para o Felipe avaliar (normalmente há base legal para manter o contrato).
- **Exportação LGPD:** a lista de documentos (categoria, data, onde está) entra no export do contato, sem os arquivos.
- **Mínimo de pessoas com acesso:** no Drive, só o Felipe e quem ele escolher. No CRM, os documentos aparecem só para membros da org.
- **Segurança:** bucket privado, links de 15 min, backup cifrado, segredos fora do Git e logs sem dado pessoal.

## 9. Passos (pequenos, reversíveis, cada um com ok do Felipe)

| Passo | O que | Teste | Como voltar |
|---|---|---|---|
| **B0** | Só leitura: confirmar se a Brisa tem Google Workspace e qual conta será dona da pasta. Medir o espaço livre na VPS. | — | — |
| **B1** | **Revogar a chave exposta da conta de serviço** no Google Cloud (Felipe, no console) e, se for usar a opção (a), criar uma chave nova guardada só na VPS (600). | A chave antiga dá "invalid_grant" | Não há volta, nem precisa: a chave antiga não deve voltar |
| **B2** | Migração do fork: bucket `locacao-processos`, regras de acesso e tabela `locacao_processo_documentos` (manifesto, baseline, `checar:colisao`, tipos). Depende da Fase 3 P1. Chave `locacao_arquivos` desligada. | Usuário da Brisa grava e lê na pasta da org dele; usuário de outra org de teste não lê; usuário não consegue apagar | `drop table` + apagar o bucket vazio |
| **B3** | Código: "usar na análise" copia o anexo para o processo; lista e download por link de 15 min; remoção lógica. | Processo de teste com documentos falsos (sem dado real); `sha256` confere; link expira | Desligar a chave |
| **B4** | Drive: Felipe cria "Contratos Brisa" (Drive compartilhado ou pasta), dá Colaborador ao robô (ou conecta o OAuth). Um teste cria uma pasta de imóvel fictício com 1 PDF falso. | Pasta e arquivo aparecem; o robô **não** consegue mandar para a lixeira (opção a) | Felipe apaga a pasta de teste à mão |
| **B5** | Fila e cron de cópia em **modo ensaio** por 3 dias: calcula pastas e nomes, sem enviar. Depois, de verdade só para 1 processo de teste. | Nenhum envio no ensaio; no teste, tudo `copiado` com md5 igual; rodar 2 vezes não duplica | Tirar a entrada do cron; zerar `drive_status` |
| **B6** | Backup VPS: script noturno para `/opt/brisa-docs` e inclusão do caminho no `brisa-backup.sh` (backup do script antes). | `restic snapshots` mostra a pasta; restaurar 1 arquivo de teste e conferir o sha256 | Recolocar o `brisa-backup.sh` antigo; apagar `/opt/brisa-docs` de teste |
| **B7** | Rotina de 90 dias com a conferência do §7, **simulada** por 2 semanas, depois de verdade. | Processo de teste vencido sem contrato: "apagaria"; com contrato e Drive OK: "apagaria"; com Drive faltando: "não apagaria + aviso" | Voltar para o modo simulado; tirar a entrada da política |
| **B8** | Lembrete anual de contratos com mais de 5 anos e pendência LGPD de contrato no Drive. | Lista de teste aparece | Desligar a tarefa |

Ligar para os processos reais só depois de B2 a B7 testados, com ok do Felipe.

## 10. Rollback geral

- Tudo atrás da chave `locacao_arquivos`. Desligar faz o painel voltar a não guardar arquivos no processo, e a fila de cópia para.
- O que já foi para o Drive **fica** (é a regra). Para desfazer um teste, só o Felipe apaga à mão.
- Migração: `drop` da tabela e do bucket (só se estiver vazio; senão, primeiro exportar).
- Backup: o `brisa-backup.sh` antigo fica guardado em `/root/backups/` antes da mudança.

## 11. Divergência do upstream

- Tudo é **novo e só do fork**: bucket, tabela, regras, cron e integração com o Drive. Não edita função nem tabela do upstream, então a divergência é baixa.
- Os pontos de contato são uma entrada nova em `lib/retencao/politica.ts` e um item no export LGPD. Os dois são marcados no manifesto.

## 12. Perguntas para o Felipe (a recomendada vem primeiro)

1. **Como o CRM entra no Drive:**
   - (a) conta de serviço **nova** + Drive compartilhado com papel Colaborador, que não consegue apagar (recomendado, se houver Workspace)
   - (b) OAuth de uma conta da Brisa com permissão só nos arquivos que o CRM cria
2. **Qual conta é dona da pasta:**
   - (a) a conta da Brisa (a do conector "brisa-alugu-is"), com o Felipe como administrador (recomendado)
   - (b) a conta pessoal do Felipe
   - (c) uma conta nova só para isso
3. **Quando copiar:**
   - (a) a partir de `contrato_criado`, seguindo até 30 dias depois de assinado (recomendado)
   - (b) só quando marcar `contrato_assinado`
4. **Nome de pastas e arquivos:**
   - (a) código + endereço curto do imóvel e id do contrato; arquivos pelo papel (locatário 1, fiador 1), sem nome de pessoa (recomendado)
   - (b) incluir o nome do locatário na pasta do contrato
5. **O que vai para o Drive:**
   - (a) tudo do processo: documentos, renda, laudo FC, seguro, relatório e contrato (recomendado)
   - (b) só documentos pessoais e contrato, sem o laudo FC
6. **Arquivos de processo com contrato no CRM:**
   - (a) apagar 90 dias depois de assinado, só se a conferência do §7 passar (recomendado)
   - (b) manter no CRM para sempre também
7. **Backup na VPS:**
   - (a) pasta `/opt/brisa-docs` dentro do backup cifrado que já roda toda noite (recomendado)
   - (b) um backup separado, só para contratos
8. **"Nunca apagado" e LGPD:**
   - (a) nada é apagado sozinho; uma vez por ano, lista de contratos encerrados há mais de 5 anos para o Felipe decidir (recomendado)
   - (b) nunca revisar
9. **Aviso de falha na cópia:**
   - (a) depois das 8 tentativas (cerca de 1 dia), aviso ao Felipe e selo no processo (recomendado)
   - (b) aviso já na 1ª falha
10. **Tamanho e tipos:**
    - (a) até 20 MB; PDF, JPEG, PNG, WEBP, HEIC (recomendado)
    - (b) até 50 MB, qualquer tipo
11. **Quem remove documento no CRM antes dos 90 dias:**
    - (a) só o Felipe, com motivo (recomendado)
    - (b) qualquer atendente, com motivo
12. **Onde roda a cópia:**
    - (a) cron do próprio CRM, onde os arquivos já estão (recomendado)
    - (b) Brisa Hub, com links assinados
