# Processo de locação — Fases 3, 3.5 e 3b

**Autorização:** Felipe, 28/10/2026 9:22 (horário de Brasília).
**Forma:** um PR grande (decisão 1b). Destino: só este fork.
**Rollback:** desligar as chaves; as tabelas ficam (decisão 11a).

Nada disto manda mensagem a contato, nada escreve na Superlógica (só GET) e
nada dispara passo pago no FC. Sem dado pessoal neste arquivo.

---

## Como ligar e desligar

Tudo nasce **desligado**. Quem administra a organização liga em
**Configurações › Locação** (`/app/settings/tenant/locacao`):

| Chave em `organizations.settings` | Efeito |
|---|---|
| `locacao.processos_habilitado` | Processo, pessoas, imóvel, etapas, aprovação |
| `locacao.arquivos_habilitado` | Anexos no bucket `locacao-processos` |
| `locacao.drive_habilitado` | Fila de cópia para o Drive (ainda precisa da credencial) |
| `locacao.aprovador_user_ids` | Quem pode aprovar (vazio = só o dono da instalação) |
| `superlogica_vinculo.habilitado` | Casamento de telefone (simulação e execução) |
| `superlogica_vinculo.ligar_unico_exato` | Só únicos exatos ligam sozinhos (**padrão sujeito à revisão do Felipe**) |

Rollback: gravar `false` nas chaves. Nenhum `DROP TABLE`. A retenção (90 dias
depois de encerrar; processo parado fecha em 30 dias) continua valendo.

---

## Decisões da Fase 3 (respostas finais)

| # | Decisão |
|---|---|
| 1b | Um PR grande |
| 2a | Quem só conversa entra com papel `contato` |
| 3a | Imóvel com registro próprio chaveado pelo ID da Superlógica; endereço só quando não há Superlógica |
| 4b | CPF criptografado no registro da pessoa (`cpf_hash` + `cpf_encrypted`; a tela vê máscara) |
| 5a | Etapas incluem `contrato_criado` |
| 6a | Processo parado fecha após 30 dias (`motivo_cancelamento = expirado`) |
| 7b | Fiador só recebe FC quando o atendente pedir (POST nomeia o participante; sem pedido automático) |
| 8 | Reaproveitar FC até 90 dias |
| 9a | Resumo sem dados pessoais guardado como histórico (`locacao_processo_eventos.detalhe` e `campos_alterados`: só ids, versões e caminhos) |
| 10a | Só o Felipe (platform admin) ou `locacao.aprovador_user_ids` aprova; qualquer atendente reprova com motivo |
| 11a | Rollback = desligar a chave e manter as tabelas |

---

## Fase 3.5 — padrões (a)

Casamento pelo telefone, só GET, simulação antes de valer. Só únicos exatos
ligam sozinhos; o resto vai para revisão.

**Backfill de produção (28/10/2026):** 150 contatos da org Brisa já tinham
chaves em `contacts.custom_fields` (`superlogica_id_pessoa`, `superlogica_tipo`,
`superlogica_situacao`, `superlogica_qualidade`, `superlogica_vinculo_lote='fase35-20261028'`,
`superlogica_vinculado_em`). A migration 0765 copia para
`contato_superlogica_vinculos` com origem `casamento_telefone`, de forma
idempotente, **sem apagar as chaves**.

---

## Fase 3b — Drive (decidido 28/10/2026 9:53) e o resto ainda (a)

Felipe fechou destino e credencial em 28/10/2026 9:53. As outras perguntas da
3b continuam na opção recomendada **(a)**, marcadas como **padrão sujeito à
revisão do Felipe**. Sem ligar `locacao.drive_habilitado` em produção até essa
revisão.

**Decidido:**

- Destino: Drive compartilhado **Aluguéis**, `driveId` `0ABm0QaUXGcgHUk9PVA`.
  Toda chamada usa `supportsAllDrives` e `includeItemsFromAllDrives`. Pasta
  pai = o próprio Drive (não há pasta raiz extra).
- Credencial: conta de serviço
  `deskcomm-crm@autorespoder-pkni.iam.gserviceaccount.com`. Papel no Drive:
  Administrador de conteúdo. O JSON inteiro vem de `DESKCOMM_GOOGLE_SA_JSON`;
  o id do Drive, de `DESKCOMM_DRIVE_ID`. Sem caminho de arquivo. A chave
  antiga ficou exposta e será revogada: este repositório não a contém.
- O código **nunca** apaga nem manda para a lixeira (`files.delete`,
  `trashed=true`, `emptyTrash` são recusados em runtime e vigiados por teste),
  mesmo com papel que o Google deixaria.
- A chave `locacao.drive_habilitado` nasce **desligada**.

**Ainda (a), sujeito à revisão:** pasta por processo no Storage; conferência
por hash; retenção 90 dias depois de encerrar; sem apagar o original no
Storage enquanto a cópia não conferir; caminho sem nome/CPF/telefone.

A parte do Google Drive fica atrás de `locacao.drive_habilitado` (desligada)
**e** das duas variáveis abaixo. Sem as duas, o cron é no-op.

---

## Variáveis de ambiente (Drive)

Só a credencial **nova**. A chave antiga ficou exposta e será revogada: este
repositório não a contém e não aceita caminho de arquivo. Os valores reais
não entram no Git nem no `.env.example`.

| Variável | O que é |
|---|---|
| `DESKCOMM_GOOGLE_SA_JSON` | JSON inteiro da conta de serviço (secret / `.env`, nunca no Git) |
| `DESKCOMM_DRIVE_ID` | Id do Drive compartilhado Aluguéis |

Vazio = o cron `/api/v1/cron/locacao-drive-copia` não envia nada.

---

## Migrations

0763 processos e imóveis · 0764 vínculos · 0765 execuções, revisões e backfill ·
0766 documentos e bucket · 0767 retenção/LGPD · 0768 FK da ficha preliminar.

Tabelas novas só neste fork. RLS por `organization_id`. Escrita pela sessão:
nenhuma (só `service_role`). Sem `SECURITY DEFINER` nova exposta a
`authenticated`.

---

## Pendências

- Revisão do Felipe do restante da Fase 3b (destino e credencial já fechados em 28/10 9:53; o resto vale a).
- Revisão do Felipe do `ligar_unico_exato` da Fase 3.5.
- Envio real ao Drive (o cron desta entrega é ensaio: não copia, não apaga).
- Módulo de vínculo no Hub (o CRM usa fonte injetável; sem Hub, a simulação
  conta zero).
- Q7 do adendo (arquivo no Hub) segue pendente.
- Fase 4 (análise no processo): ver `docs/decisoes/locacao-fase4-analise.md`.
