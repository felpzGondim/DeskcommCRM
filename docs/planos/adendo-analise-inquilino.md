## Adendo: análise completa de inquilino no CRM

**Status:** plano, só leitura. Nada foi mudado no banco, no código em produção, no Hub ou na VPS.
**Data do levantamento:** 28/10/2026.
**Pedido do Felipe:** "Eu quero que leia sim. Podemos até criar uma função pra isso. Na prática o que eu quero é o que o Análise De Inquilinos já faz sozinho, mas dentro do CRM."
**Liga com:** Fase 2 (PR #15, leitura de anexos), Fase 3 e 3b (processo, documentos, Storage) e Fase 4 (os 4 botões) deste plano.

---

### A.1 Resumo em 6 linhas

1. O bot **Análise De Inquilinos** faz tudo hoje pelo navegador do computador dele: lê os arquivos, analisa a renda, roda a FC Score+, cota na Migra e escreve o relatório de 6 seções.
2. Boa parte da parte "robô" **já existe na VPS**: o container `brisa-hub-analise` (Playwright) já sabe entrar na FC e na Migra, salvar a ficha, cotar e baixar o laudo. Mas ele **nunca rodou um caso real registrado** e o CRM só consegue **dar a partida**. Ele não consegue acompanhar, confirmar a cobrança nem receber o resultado.
3. **Achado importante:** nem a automação da FC nem a da Migra envia arquivo para o site. As duas só preenchem formulário com dados. **Os arquivos do candidato só servem para a análise de renda e para o arquivo do processo**, e isso pode ficar 100% dentro do CRM (o PR #15 já lê os anexos).
4. Por isso, a recomendação é: **arquivos ficam no CRM**, o Hub recebe **só dados estruturados** e devolve **resultados** (cards da Migra, ID e laudo da FC).
5. A análise de renda e o relatório de 6 seções ficam **no CRM, com o Gemini** (o mesmo ponto de IA do PR #15). A FC e a Migra ficam **no Hub (Playwright)**, com **modo manual assistido** de reserva.
6. Dá para entregar em fases pequenas, uma por botão, cada uma com chave liga/desliga.

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
- **Retenção:** um job parado some em 24 h. Os arquivos somem 24 h depois da conclusão. As respostas mascaram o CPF e os logs não mostram CPF nem texto de extrato. Os prints de auditoria ficam na pasta do job.
- **Uso real:** 0 jobs no disco. O log mostra só a subida do container (27/10, 12:02) e um teste 404. **Trate como não validado em produção.**

**Hub `brisa-hub` (MCP) v0.4:** a ferramenta `iniciar_analise_inquilino` existe só para o papel `crm`.
- Recebe `pedido_id`, `conversa_id`, `organization_id`, `candidato`, `imovel` e `renda`. **Não tem campo de arquivos.**
- Chama `/jobs/iniciar-do-crm`, que é idempotente e roda **Migra + FC SALVAR juntas** em segundo plano.
- Responde só `aceito`, `ja_existia`, `indisponivel` etc.

**O que falta para o CRM fazer o ciclo inteiro:**

| Lacuna | Onde |
|---|---|
| Ver o andamento e o resultado do job (status, cards da Migra, ID-FC) | Hub: falta a ferramenta de status. Já estava prevista como "Fase 1.B, outro PR" no `docs/AGENTS.md`. |
| Confirmar a cobrança da FC a partir do CRM | Hub: falta a ferramenta. O README diz que o MCP **nunca** chama `confirmar-cobranca-fc`. |
| Rodar Migra e FC separadas (um botão para cada) | Hub: hoje é uma partida única para as duas. |
| Trazer o laudo PDF da FC e o print da Migra para o CRM | Hub: o arquivo existe em `/jobs/{id}/arquivo/...`, mas não há caminho pelo MCP. |
| Análise de renda escrita (não só a soma) | Ninguém faz. Proposta: CRM. |
| Relatório de 6 seções | Ninguém faz. Proposta: CRM. |
| Guardar os resultados no processo | CRM, Fase 3 / 3b (tabela do processo e bucket `locacao-processos`). |

Nota de histórico: a nota de arquitetura de 18/10 dizia "sem navegador na VPS; FC e Migra continuam com o bot". Isso **foi superado** quando o `brisa-hub-analise` com Playwright subiu. Este adendo registra a mudança.

---

### A.4 Como os arquivos chegam (resposta à Q7)

**Ponto de partida:** a FC e a Migra **não recebem arquivo**. Então a pergunta certa não é "como mandar arquivo para o Hub", e sim "**quem precisa ler o arquivo**". Resposta: só a análise de renda e o arquivo do processo. Os dois ficam no CRM.

| Opção | Como funciona | Prós | Contras | LGPD / retenção |
|---|---|---|---|---|
| **0. Não mandar (recomendado)** | O CRM lê os anexos (PR #15) e manda ao Hub só os dados (nome, CPF, renda confirmada, imóvel, contatos). | Nenhuma cópia extra de extrato na VPS. Nada novo para proteger. Nenhuma mudança no Hub para isso. | O `renda.py` do Hub (soma por regex) deixa de ser usado, ou vira só uma conferência opcional. | É a menor exposição possível: o arquivo mora só no Storage do CRM. |
| 1. URL assinada | O CRM gera URLs do Storage válidas por 15 minutos (o PR #15 já faz isso se o schema anunciar `arquivos`). O Hub baixa os arquivos em segundo plano. | Padrão comum. Não passa bytes pelo MCP. | Precisa de lista de hosts permitidos (anti-SSRF), limite de tamanho e de tipo, e download assíncrono (o MCP tem só 12 s). Gera uma segunda cópia na VPS. | A cópia do Hub some em 24 h (já implementado). A URL expira em 15 min. |
| 2. Base64 / multipart no MCP | Os bytes vão dentro da chamada. | Simples para foto pequena. | Um extrato de 20 MB vira uns 27 MB de JSON passando pelo Caddy, num Hub com limite de 256 MB. Ruim. | Os bytes passam por mais camadas. |
| 3. Endpoint HTTP novo no Hub | Rota `POST` multipart fora do MCP, com a chave do CRM. | Aguenta arquivo grande. | Mais uma porta pública para proteger e testar. | Igual à opção 1. |
| 4. Pasta temporária compartilhada | O CRM e o Hub estão na mesma VPS: uma pasta montada nos dois containers. | Rápido, sem rede. | Amarra os dois sistemas (se o CRM mudar de servidor, quebra). Dá trabalho com permissão de usuário. É difícil auditar quem leu. | Precisa de uma limpeza própria. |

**Recomendação:** opção **0** agora. Deixar a **opção 1** escrita como caminho futuro, só se algum site passar a exigir upload de documento.

**Retenção proposta (alinhada à §4.6 e à Fase 3b):**
- Arquivo original da conversa: fica em `whatsapp-media`, com a regra atual.
- Cópia classificada, laudo FC e print da Migra: ficam no bucket `locacao-processos`. Somem em **90 dias** se não virar contrato. Se virar contrato, vão para o Drive e para o backup na VPS.
- No Hub: o job e os prints de auditoria somem em **24 h** (já é assim).
- Logs e `audit()`: sem CPF, sem bytes, sem texto de extrato.
- A análise de crédito para locação se apoia na base legal de proteção do crédito e no procedimento pré-contratual. A FC exige usuário com CRECI ativo, o que a Brisa já tem.

---

### A.5 Como trazer a FC e a Migra para o CRM

| Opção | Como funciona | Prós | Riscos e contras | Custo |
|---|---|---|---|---|
| **A. Playwright no Hub (recomendado como principal)** | O `brisa-hub-analise`, que já existe. O CRM pede, acompanha e confirma pelo MCP. | Já está quase pronto. Roda sem depender do computador do bot. Já tem trava antes do passo pago e retomada em `login_necessario`. | **Termos de uso:** automatizar o login pode não ser permitido no contrato da FC ou da Migra. **Captcha:** hoje não há, mas pode aparecer. **Layout:** se o site mudar, o robô quebra. **Sessão:** expira e exige novo login. **Memória:** o Chromium usa 300 a 600 MB (há uns 2 GB livres e o limite do container é 900 MB). Um job por vez. | Sem custo novo de servidor. Só o trabalho de desenvolvimento. |
| B. Bot Análise De Inquilinos como executor (webhook) | O CRM dispara o bot, que faz no navegador dele e devolve o resultado. | Usa o fluxo que já funciona hoje. | Não existe um gatilho estável de "chamar o bot e receber a resposta estruturada". O retorno é texto, não dados. Os dados pessoais passam por mais um sistema. Depende do computador do bot estar livre. É mais lento. | Uso do bot por análise. |
| **C. Manual assistido (recomendado como reserva)** | O CRM mostra os dados já formatados (com botão de copiar) e o link da FC e da Migra. O atendente faz no site e sobe o laudo PDF ou o print. O Gemini lê e preenche o bloco. | Zero risco de termos de uso ou de captcha. Sempre funciona. | Mais cliques. Depende de o atendente subir o arquivo certo. | Só a IA para ler o laudo (centavos). |
| D. API oficial (futuro) | A FC tem integrações com sistemas imobiliários (Imoview/Universal, Imobzi, Rede Izee, Rua Dois, Si9, Sohtec) e um painel de desenvolvedor fechado (`devpanel.fcanalise.com.br`). A skill do bot cita `api.fichacertadigital.com.br` "se a conta tiver permissão de API". A Migra anuncia "integração API REST com chaves únicas por imobiliária" (usada por Imobzi, Vistasoft, Immobile, Pleno), com token fornecido por ela. | É o caminho mais estável e dentro das regras. Sem navegador. | **Nenhuma das duas tem documentação pública.** Precisa pedir ao comercial ou ao suporte. Pode exigir contrato de parceiro ou plano específico. A Superlógica (Hub de Garantias) ainda não tem seguro fiança ("em breve"). | A combinar com cada empresa. |

**Recomendação:** **A + C** na mesma tela. A é o caminho normal. C entra sozinho quando o job cair em `erro` ou `login_necessario`, ou quando a chave do robô estiver desligada. **Em paralelo, pedir a API oficial (D)** à FC e à Migra. Quando ela vier, troca só o "motor" atrás das mesmas ferramentas do Hub, e o CRM nem percebe.

O bot Análise De Inquilinos (B) continua como está **até o CRM fechar de 3 a 5 casos reais sem ajuda**. Depois vira só reserva manual.

---

### A.6 Os 4 botões da Fase 4, já com o desenho acima

| Botão | Quem faz | Custo em dinheiro | Trava | Resultado guardado |
|---|---|---|---|---|
| **1. Analisar renda** | CRM. O Gemini lê o texto que o PR #15 já extrai e aplica as regras da skill `analise-financeira-inquilino` (tira autotransferência, poupança e Rende Fácil; PIX de terceiros não é renda fixa). | Só IA: centavos por candidato, registrados em `llm_calls`. | O atendente **confirma a renda** antes de seguir. Sem confirmação, os botões 2 e 3 ficam cinza. | Bloco "renda": comprovada, proposta para a FC, alertas e trechos de evidência. |
| **2. Analisar seguro-fiança** | Hub, com acao `seguro` (só Migra, só **Analisar**). O CRM acompanha pelo status. | A cotação, até onde se sabe, **não cobra** da imobiliária (a Migra ganha na contratação). **Confirmar com a Migra.** | Um clique. Se a Migra cobrar a cotação, vira dois cliques. "Contratar" **nunca** aparece. | Bloco "seguro": seguradoras, código da cotação, status, planos e o print. |
| **3. Analisar FC** | Hub. **Clique 1:** `fc_salvar` (grátis, gera o ID-FC, PENDENTE). **Clique 2:** caixa "Confirmo a cobrança de R$ X por pretendente" → `confirmar_cobranca_fc`. | **FC Score+**: na tabela pública, **R$ 25,30 avulso pré-pago** (de R$ 32,00), com uma faixa de **R$ 17,60**. O valor real depende do plano da Brisa. Provavelmente é cobrado **por pretendente**. Confirmar na fatura. | Segundo clique com o valor na tela. Só para o papel definido pelo Felipe. Uma confirmação vale **uma** cobrança. O Hub recusa repetir o mesmo ID-FC. | Bloco "fc": ID-FC, score e risco, restrições e o laudo PDF. |
| **4. Gerar relatório** | CRM. O Gemini usa o `PROMPT-FORMATO.md` (6 seções) e **só** os blocos 1 a 3 guardados, nunca a conversa crua. | Só IA (centavos). | O texto é editável. O Felipe aprova. Nunca diz "alugue / não alugue", só risco baixo, moderado ou alto. | Bloco "relatorio" mais um PDF no processo (categoria `relatorio`). |

**Mudanças no Hub (todas do papel `crm`, todas atrás de uma chave):**
1. `status_analise_inquilino(pedido_id)`: só leitura. Devolve estado, cards da Migra, ID-FC, se há laudo e o erro, se houver. (É a "Fase 1.B" que já estava prevista.)
2. Campo `acao` em `iniciar_analise_inquilino` com os valores `seguro` e `fc_salvar`, para separar os botões. O comportamento antigo (as duas juntas) continua como padrão até o CRM migrar.
3. `confirmar_cobranca_fc_analise(pedido_id, confirmado: true, confirmado_por, valor_exibido)`: idempotente, auditado e recusado se o estado não for `aguardando_cobranca_fc`.
4. `baixar_resultado_analise(pedido_id, tipo: laudo|print_migra)`: devolve o arquivo (laudo e print são pequenos, abaixo de 2 MB) **ou** sobe direto numa URL de upload assinada que o CRM fornece. Escolher uma das duas na implementação.
5. **Não** adicionar campo de arquivos (veja A.4).

**Mudanças no CRM:**
- 4 botões no Painel do Agente ou na tela do processo, com acompanhamento por consulta ao status a cada 10–20 s enquanto houver job ativo.
- Duas rotas de IA novas: renda e relatório. Elas reaproveitam o ponto `visao_de_imagem` / `painel_atendente`.
- Modo manual assistido (opção C), com upload do laudo e do print.
- Chave por org em `organizations.settings.locacao.analise` (`renda`, `seguro`, `fc`, `relatorio`, `manual`).

---

### A.7 Fases pequenas e reversíveis

| Fase | O que entra | Como desfazer | Esforço estimado |
|---|---|---|---|
| **A0. Decisões e teste de bancada** (sem código) | O Felipe responde às perguntas de A.9. Teste guiado do `brisa-hub-analise` com um caso autorizado: **Migra Analisar + FC só SALVAR** (grátis), para validar login, sessão e seletores. Pedir a API à FC e à Migra (rascunhos em A.10). | Nada a desfazer. | 1 sessão |
| **A1. Status no Hub** | Ferramenta 1 (só leitura). Imagem nova com tag nova. | Voltar a tag anterior. | Pequeno |
| **A2. Botão "Analisar renda"** | Só CRM: rota de IA mais o bloco na tela. Antes da Fase 3, o resultado vive só na sessão da prévia (como no PR #15). Com a Fase 3, ele é gravado no processo. | Chave `renda` desligada. | Médio |
| **A3. Botão "Analisar seguro-fiança"** | Hub: `acao=seguro` e a ferramenta 4 (print). CRM: botão, acompanhamento e cards. | Chave `seguro` desligada. O Hub mantém o padrão antigo. | Médio |
| **A4. Botão "Analisar FC"** | Hub: `acao=fc_salvar`, a ferramenta 3 e o laudo pela ferramenta 4. CRM: dois cliques, caixa com o valor e `audit()`. | Chave `fc` desligada. Sem a ferramenta 3, ninguém cobra. | Médio |
| **A5. Botão "Gerar relatório"** | CRM: prompt de 6 seções, edição e PDF. Guardar no processo exige a Fase 3 / 3b. | Chave `relatorio` desligada. | Médio |
| **A6. Manual assistido** | CRM: dados para copiar, links e upload de laudo e print, com leitura pelo Gemini. Aparece sozinho em `erro` ou `login_necessario`. | Chave `manual` desligada. | Pequeno/médio |
| **A7. API oficial** (se vier) | Troca o motor no Hub. O CRM não muda. | Voltar para o Playwright. | Depende da API |

**Ordem sugerida:** A0 → A1 → A2 → A3 → A4 → A6 → A5. O relatório fica no fim porque depende dos três blocos e da Fase 3 para guardar.

**Dependências:**
- O A2 pode andar já, sobre o PR #15.
- Para gravar resultados, o A3–A5 precisam da Fase 3 (processo) e da 3b (bucket).

---

### A.8 Custos e riscos

**Custos por candidato (estimativa):**
- FC Score+: R$ 17,60 a R$ 25,30 por pretendente, conforme o plano. É o único custo relevante e só sai no segundo clique.
- Migra: R$ 0 na cotação (confirmar).
- Gemini: leitura de anexos (o PR #15 já gasta isso), mais renda e relatório. São centavos, até poucos reais num extrato longo escaneado. Fica registrado em `llm_calls`.
- VPS: nada novo. O container já está de pé (23 MB parado, até 900 MB rodando).

| Risco | Chance | Efeito | Como reduzir |
|---|---|---|---|
| Termos de uso da FC/Migra proíbem automação | Média | Bloqueio da conta | Perguntar antes (A0). Usar o manual assistido. Pedir a API oficial. |
| Captcha ou 2FA aparece no login | Baixa/média | O robô para | O job vai para `login_necessario`. A tela oferece o manual. |
| O site muda o layout | Média | Seletor quebra | Prints de auditoria. Teste de bancada mensal com SALVAR (grátis). |
| Sessão expirada | Alta | Atraso | Login automático já existe. A retomada também. |
| Cobrança em dobro da FC | Baixa | R$ perdido | Confirmação de uso único. O Hub recusa o mesmo ID-FC. `audit()`. |
| IA erra a renda (visão não é OCR financeiro) | Média | Renda errada na FC | O atendente confirma a renda. Trechos de evidência na tela. Conferência opcional com a soma do `renda.py`. |
| Vazamento de dado pessoal | Baixa | LGPD | Arquivos não saem do CRM. Hub com 24 h. Logs sem CPF. Bucket privado. Poda de 90 dias. Cascata LGPD (§4.6). |
| Memória da VPS (Chromium + WAHA + n8n) | Baixa | Lentidão | Um job por vez. Limite de 900 MB. Monitorar no A0. |
| Automação nunca testada de verdade | Alta | Falha no 1º caso | A0 antes de qualquer botão. Bot como reserva até 3–5 casos bons. |

---

### A.9 Perguntas para o Felipe

1. **Q7 (arquivos):** posso fechar como "os arquivos ficam no CRM e o Hub recebe só os dados"? (A FC e a Migra não pedem arquivo.)
2. **Renda e relatório no CRM com o Gemini**, e não no Hub? Usar o mesmo ponto `visao_de_imagem` ou criar um ponto `painel_analise` separado, para ver o custo à parte?
3. **Robô na FC/Migra (Playwright):** você aceita o risco de termos de uso enquanto a API não vem? Ou prefere começar só pelo manual assistido?
4. **FC:** qual é o plano da Brisa (pré ou pós-pago) e o preço por consulta? Cada colocatário é cobrado à parte? **Quem pode dar o segundo clique** (só você, ou admin)?
5. **Migra:** a cotação tem algum custo? Quais seguradoras você quer ver?
6. **Antes da Fase 3:** quer o botão "Analisar renda" já (resultado só na tela, sem gravar) ou prefere esperar a Fase 3 para tudo ser gravado no processo?
7. **Retenção:** está bom 24 h no Hub e 90 dias no CRM para o laudo FC e o print da Migra de quem não fechou?
8. **Teste A0:** podemos fazer um teste com **Migra Analisar + FC só SALVAR** (grátis) com um caso que você autorizar?
9. **API oficial:** quer que eu prepare (sem enviar) os e-mails para a FC e a Migra (A.10)? De qual conta?
10. **Bot Análise De Inquilinos:** fica em paralelo até 3–5 casos fecharem no CRM e depois vira só reserva? Concorda?

---

### A.10 Rascunhos para pedir a API (não enviados)

**Para a FC ANALISE** (suporte `fcsuporte@fichacerta.com.br` ou comercial `fcanalise@fichacerta.com.br`)
Assunto: Acesso à API do FC Score+ para integração com nosso CRM
> Olá! Somos a Brisa Aluguéis, cliente da FC. Queremos integrar o FC Score+ (cadastro, processamento e laudo em PDF) ao nosso CRM interno, sem uso do painel web. Vocês oferecem API para clientes diretos (vimos o DEV FC PANEL e a menção a api.fichacertadigital.com.br)? Quais são os requisitos, o custo e a documentação? Obrigado!

**Para a MigraSeguros** (pelo canal de parceiros em migraseguros.com.br/integracoes)
Assunto: Token de API para cotação de seguro fiança (Multi Cálculo PF Residencial)
> Olá! Somos a Brisa Aluguéis, imobiliária parceira. Queremos cotar seguro fiança (Multi Cálculo PF Residencial) direto do nosso CRM pela API REST de vocês, só análise e cotação, sem contratação automática. Como obtemos o token e a documentação? Há algum custo? Obrigado!

---

### A.11 Trilha para o AGENTS.md

- **Não** criar campo de arquivos no Hub (Q7 resolvida pela opção 0, se o Felipe confirmar).
- **Nunca** expor "Contratar" da Migra nem chamar `confirmar-cobranca-fc` sem o segundo clique humano registrado.
- O relatório usa **só** os blocos guardados (renda, seguro, fc), nunca a conversa crua.
- Cada botão tem uma chave própria em `organizations.settings.locacao.analise`.
- Logs e auditoria sem CPF, nome, bytes ou texto de extrato.
