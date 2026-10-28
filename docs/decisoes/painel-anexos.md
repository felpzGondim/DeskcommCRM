# Painel: leitura de anexos (Fase 2)

**Status:** implementado neste fork em `feat/fase2-anexos`. Não sobe para o Deskcomm original.
**Plano:** [`docs/planos/processo-de-locacao.md`](../planos/processo-de-locacao.md).

## O que mudou para o atendente

- A análise e a ficha leem o **conteúdo** do anexo (texto do PDF, OCR de PDF escaneado, visão da foto), não só o nome e a legenda.
- Foto de holerite entra como comprovante quando a visão documental extrai valor e trecho. A descrição curta do worker ("parece um extrato") **não** libera confirmação.
- PDF com senha pede a senha no painel. A senha vive só na sessão (até 3 tentativas). Não é gravada.
- Conversa longa não devolve mais 422. Usa as últimas mensagens úteis (anexo ou número/CPF/endereço).
- Se o Hub anunciar o campo `arquivos` (ou `anexos`) em `iniciar_analise_inquilino`, o CRM manda URLs assinadas de 15 minutos. Sem esse campo, o job segue só com o JSON — o Hub ainda não aceita arquivo.

## Limites (padrão)

| Recorte | Valor | Por quê |
|---|---|---|
| Mensagens lidas | 400 brutas / 80 úteis | Troca o bloqueio de 200 |
| PDFs reabertos | 12, até 10 MB | RG + holerites + extrato de 1–2 pessoas |
| Fotos na visão | 8, até 8 MB | Cada uma é chamada paga |
| OCR de PDF | 8 páginas | Q5 do plano seguia aberta; 8 cobre RG + holerite |
| Texto | 40 mil/arquivo, 80 mil no conjunto | Cabe na prévia |
| URL assinada | 15 min | O Hub baixa na hora |
| Senha | 3 tentativas | Pedido do plano |

Afinar sem migration: `organizations.settings.locacao.anexos` (jsonb). Valor inválido cai no padrão. Sem tela de configuração nesta fase.

## Decisões técnicas

- Ponto de IA: **reusa `visao_de_imagem`** (o Gemini do menu Provedores). Não criamos `painel_documento` para não exigir configuração nova. Orçamento separado fica para depois, se o custo pesar. PDF escaneado vai primeiro como `application/pdf` para a visão; raster de página só se isso falhar (e se `@napi-rs/canvas` existir).
- Texto da mensagem: `textoCombinadoDaMensagem` junta legenda + derivado. Nunca `body ?? derivado`.
- A leitura documental da prévia **não é gravada** no banco (Fase 3). O token da prévia leva um mapa path→texto só para a confirmação não chamar a visão de novo (e não divergir o hash).
- Arquivo no Hub: URL assinada, só se o schema da ferramenta tiver o campo. Multipart e endpoint novo **não** entram — seria mudar o Hub.
- Storage/Drive/pasta do processo: **Fase 3b**. Não implementado.

## O que a próxima sessão NÃO deve fazer

- Não criar bucket `locacao-processos` (3b).
- Não gravar senha de PDF.
- Não logar CPF, nome ou texto extraído.
- Não alterar Brisa Hub, VPS, tag ou imagem.
- Sem resposta do Felipe em Q7 (URL vs multipart), não inventar endpoint novo.

## Living System Checklist

1. Quem me alimenta? Mensagens da conversa + `whatsapp-media` + ponto `visao_de_imagem`.
2. Quem eu alimento? Prévia da análise, ficha temporária, e (se anunciado) `iniciar_analise_inquilino`.
3. Registro: `ai.painel_atendente.analise` / `.ficha` — sem PII. Custo em `llm_calls` com `purpose=visao_de_imagem`.
4. Tela: `PainelDoAgente` (aviso de senha, limites, prévia).
5. Porta: Inbox → Painel do agente (já existia).
6. Anti-morte: pendência visível; senha errada não derruba o painel; 3 falhas deixam o arquivo pendente.
7. Configuração: Provedores (`visao_de_imagem`) + jsonb opcional de limites.
8. Continuidade: o atendente confere a prévia; a IA não confirma sozinha.
9. Laço: descrição genérica não libera; conversa que muda invalida o token (409).
10. Mapa: `docs/architecture/painel-acoes-hub.architecture.json` (nós `anexos`, `visao`, `storage`).
