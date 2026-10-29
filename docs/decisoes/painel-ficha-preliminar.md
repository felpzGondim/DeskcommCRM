# Painel: relatório preliminar e ficha de dados (A1)

**Status:** implementado neste fork. Não sobe para o Deskcomm original.
**Plano:** adendo de análise + §3 do plano da Fase 3 (schema A.6b). A Fase 3 em si **não** foi criada.

## O que o atendente vê

No Painel do agente, o botão **Gerar relatório preliminar** lê as 200 mensagens mais recentes e o conteúdo dos anexos (Fase 2: PDF, OCR/visão, senha na sessão). Devolve:

1. um relatório interno em 6 seções da skill Análise De Inquilinos (1 Identificação, 2 Resumo da Análise, 3 Análise de Crédito, 4 Análise de Renda, 5 Análise Financeira e Despesas, 6 Análise de Risco para Locação), só para a equipe — nunca "alugue"/"não alugue";
2. a **ficha de dados** (pessoas, renda, imóvel, documentos, pendências), que o atendente confere e corrige.

## Renda comprovada (correção 20:57 — vale acima da orientação anterior sobre PIX)

**Entram** na renda comprovada, mês a mês:

- salário / pró-labore / holerite líquido;
- PIX/TED de **terceiros** (empregador, clientes fixos e **avulsos**). Para cada pagador a tabela mostra recorrência: meses em que aparece, número de lançamentos, total por mês;
- vendas no cartão / maquininha (recebimento de clientes; linha própria no relatório).

**Saem** da renda, com o volume informado à parte:

1. transferências da própria pessoa (mesmo CPF ou nome, contas próprias);
2. transferências de familiares diretos (pai, mãe, cônjuge, filhos, tios);
3. poupança / resgates / aplicações / Rende Fácil, estornos e empréstimos.

Regra de familiar (`lib/locacao/extrato/familiar.ts`):

| Match                                                                           | Destino                                                                                                                                            |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nome ou CPF da ficha (cônjuge, pais/parente) ou palavra de parentesco           | Excluído confirmado. Volume à parte.                                                                                                               |
| Só sobrenome em comum com o titular, sobrenome muito frequente, ou nome parcial | Excluído da **comprovada**, entra na lista **familiar provável — conferir** (com o valor) e na **renda com prováveis**. Nunca descarte silencioso. |

O relatório mostra a renda **com** e **sem** os prováveis, para o analista reconsiderar. O valor declarado **nunca** é tratado como comprovado.

## O que a skill NÃO decide (opção conservadora, CONFIRMADO neste fork)

- Média só dos **meses completos** (dia 1–5 até 25–31). Mês parcial não entra na média.
- Página faltando: a renda daquele período **não é estimada** (`pagina_faltando`).
- Vários extratos: média das comprovadas.
- Extrato escaneado/ilegível: diz e não estima.
- Sem renda comprovada o risco não pode ser `baixo`.
- Comprometimento = aluguel pretendido / renda comprovada × 100.

## 3× o pacote (Q7, 20:51)

3× = 3 × (aluguel + condomínio + IPTU + **seguro-incêndio**). Seguro-fiança **não** entra. Superlógica só GET, quando o imóvel está vinculado; neste repo não há cliente HTTP — a interface é injetável atrás da chave `locacao.pacote_superlogica_habilitado` (desligada). Fallback: conversa / ficha. Componente ausente é declarado, não vira zero silencioso. Sem o aluguel: `3x não calculado: falta o valor do pacote`.

## Extração de qualquer banco (Q6, 20:51)

Parser Stone + C/D genérico primeiro. Se o layout não for reconhecido ou o saldo não fechar, a IA extrai lançamentos em JSON (lotes de página, mesmo `painel_atendente` / `runModelCall`). A classificação e a conferência de saldo são as mesmas. Se ainda não fechar: pendência com extrato/período/diferença — não "sem lançamentos legíveis". Fonte marcada `parser` ou `IA`; a chamada vai para `llm_calls`.

O módulo `lib/locacao/extrato` é o mesmo que a análise 4.1 e o relatório 4.5 devem reusar.

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
- Não chama Migra nem `/contrato/confirmar`. Superlógica no 3× é só GET, injetável, e a chave nasce desligada.
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
