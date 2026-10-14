# Brisa Aluguéis — o que fazer agora (só locação)

Site: `https://srv2017601.hstgr.cloud`  
Empresa: **Brisa Aluguéis**  
Fuso: América/São Paulo

Este arquivo é o roteiro da tela. Nada disso se resolve editando o banco.

## O que já está pronto

- As chaves do Google e da OpenAI estão cadastradas e validadas em **IA › Credenciais**.
- O agente **Locação** está publicado, no automático, e não está pausado.
- O texto dele já atende interessado em kitnet ou casa na zona norte de São Paulo, uma pergunta por vez, só com o que estiver na ficha do imóvel. Não negocia valor, não marca visita na conversa (manda o link da ficha) e chama uma pessoa quando pedem atendente, documento ou desconto.
- O material **Regras da locação** está pronto (14 trechos) e ligado nesse agente.
- A memória da empresa já tem uma versão publicada.

## O que está no caminho

Há dois números conectados:

| Final do número | Quem está nesse número |
|---|---|
| 2234 | Locação e Inquilino. É o número da locação. |
| 5983 | Atendente IA, pausado. Esse número não recebe resposta automática enquanto ele continuar pausado. |

No número **2234** o sistema escolhe o agente publicado de **maior ordem de preferência**. Hoje:

| Agente | Ordem | Situação | O que acontece |
|---|---|---|---|
| Inquilino | 20 | Publicado e pausado | É o escolhido. Como está pausado, a mensagem para e a Locação não entra. |
| Locação | 10 | Publicado, automático, no ar | Só atende se for o escolhido. |
| Proprietário | 30 | Sem versão publicada | Não atende. |
| Atendente IA | 0 | Publicado e pausado, no número 5983 | Não atende. |

O roteador **Teste** está ligado no número 2234, sem assuntos e sem agente reserva. Nesse estado ele não toma o atendimento. Desligado, ninguém acrescenta um assunto nele sem querer.

## Faça nesta ordem

Entre como administrador da Brisa Aluguéis.

1. **IA › Agentes › Inquilino.** No campo **Ordem de preferência (0 a 1000)**, troque 20 por **0**. Salve. Não publique versão nova e não despausar. A ordem vale ao salvar, porque ela fica no cadastro do agente, não na versão. Na lista, a prioridade do Inquilino tem que aparecer menor que a da Locação (10).
2. **IA › Roteadores.** Desligue o roteador **Teste**.
3. Não despausar o **Atendente IA** nem o **Inquilino**. Não arquive o Inquilino: arquivar não tem volta pela tela.
4. Do seu celular, mande no WhatsApp do número **2234**: `quero alugar uma kitnet na zona norte`. A resposta tem que ser da Locação: uma pergunta só, pedindo bairro ou rua, sem inventar imóvel.
5. Se não chegar resposta, pare e não publique nada. O passo 1 não pegou.

## Conferir, sem mudar ainda

- As fichas dos imóveis disponíveis (preço, vaga, pet, link de visita, link do QuintoAndar) precisam estar onde o agente lê. O prompt só oferece o que a ficha disser. O material ligado hoje é **Regras da locação**, em **IA › Conhecimento**.
- A Locação não está ligada a nenhum funil. Ela conversa e não move negócio no quadro. Ligar funil é uma versão nova: salve e só publique depois de ver o teste.
- Follow-up de quem sumiu fica para depois. Fluxo não publicado não roda.

## O que ainda preciso que você decida

Uma resposta por vez, quando for a hora:

1. O número **2234** é mesmo o da locação?
2. O agente pode só conversar, ou também deve registrar a busca no funil?
3. Qual o tom se o atual (próximo e objetivo) não servir?
4. Até onde ele pode ir sozinho, além do que o texto já proíbe (desconto, contrato, data de mudança, análise)?
