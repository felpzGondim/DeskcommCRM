# Painel: relatório preliminar e ficha de dados (A1)

**Status:** implementado neste fork. Não sobe para o Deskcomm original.
**Plano:** adendo de análise + §3 do plano da Fase 3 (schema A.6b). A Fase 3 em si **não** foi criada.

## O que o atendente vê

No Painel do agente, o botão **Gerar relatório preliminar** lê as 200 mensagens mais recentes e o conteúdo dos anexos (Fase 2: PDF, OCR/visão, senha na sessão). Devolve:

1. um relatório interno em 6 seções (Identificação, Renda comprovada, Comparação com declarado e 3x o pacote, Documentos, Alertas, Risco), só para a equipe — nunca "alugue"/"não alugue";
2. a **ficha de dados** (pessoas, renda, imóvel, documentos, pendências), que o atendente confere e corrige.

A renda comprovada sai dos créditos do extrato, mês a mês, excluindo transferências entre contas próprias, estornos/devoluções, resgates/aplicações e empréstimos. O valor declarado **nunca** é tratado como comprovado. Se o extrato for escaneado, ilegível ou só movimento de negócio, o relatório diz isso e não estima. Sem o pacote (aluguel+condomínio+IPTU): `3x não calculado: falta o valor do pacote`. Sem renda comprovada o risco não pode ser baixo. O módulo `lib/locacao/extrato` é o mesmo que a análise 4.1 e o relatório 4.5 devem reusar.

**Salvar ficha** grava uma versão nova. O histórico mostra quem, quando e **quais caminhos** mudaram — nunca os valores.

A análise paga (**Iniciar análise de inquilino**) usa o celular da pessoa com papel `inquilino` principal. Se faltar, o painel pede o número. Não usa o telefone de quem só conversa (parente, corretor).

Nenhuma mensagem vai ao cliente. "Usar como resposta" continua sendo só o Composer.

## O que é gravado

Tabela `locacao_fichas_preliminares` (migration 0762): uma linha por versão, só acrescenta. `organization_id` + RLS de leitura. Escrita só `service_role`. Sem SECURITY DEFINER. `processo_id` nasce nulo, sem FK, para a Fase 3 só apontar.

O JSON segue `fichaPreliminarSchema` (`lib/locacao/ficha-schema.ts`, `versao: preliminar-v1`). Papéis: `inquilino`, `solidario`, `fiador`, `contato`. Cada campo leva fonte, trecho, confiança e `message_id`.

CPF completo vive **dentro** da ficha versionada (como o plano da Fase 3 descreve). Não vai para `audit()`, log nem `campos_alterados`. Os helpers `encrypt_cpf` / `cpf_hash` continuam no contato do CRM; a A1 não inventa coluna cifrada no jsonb.

## O que a A1 NÃO faz (A2+)

- Não cria `locacao_processos` nem participantes.
- Não dispara FC Score+, não cria pedido de análise, não chama `confirmar-cobranca-fc`.
- Não chama Migra, SuperLógica nem `/contrato/confirmar`.
- Não envia arquivo ao Hub (Q7 aberto).
- Não cria bucket, não grava senha de PDF, não expurga as versões (retenção de 90 dias = Fase 3).

## Living System Checklist

1. Quem me alimenta? Conversa (200 msgs) + anexos Fase 2 + `visao_de_imagem` + `lib/locacao/extrato`.
2. Quem eu alimento? Tela do painel; a rota de análise (celular do inquilino); no futuro, processo/FC/contrato e análises 4.1/4.5.
3. Registro: `ai.painel_atendente.ficha_preliminar` / `.ficha_salva` — versão e caminhos, sem PII.
4. Tela: `FichaPreliminarPainel` no `PainelDoAgente`.
5. Porta: Inbox → Painel do agente (já existia).
6. Anti-morte: pendências na ficha; sem celular do inquilino a análise para e pede o número.
7. Configuração: mesmos limites de `organizations.settings.locacao.anexos` (Fase 2). Sem tela nova.
8. Continuidade: a IA rascunha; o atendente corrige e salva. A IA não confirma FC.
9. Laço: conflito de versão (409) obriga recarregar; gerar de novo acrescenta versão, não apaga.
10. Mapa: `docs/architecture/painel-acoes-hub.architecture.json` (nós `ficha_botao`, `ficha_rota`, `ficha_tabela`, `extrato`).
