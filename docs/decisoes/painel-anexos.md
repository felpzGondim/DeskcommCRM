# Painel: leitura de anexos (Fase 2)

**Status:** implementado neste fork em `feat/fase2-anexos`. Não sobe para o Deskcomm original.
**Plano:** [`docs/planos/processo-de-locacao.md`](../planos/processo-de-locacao.md).
**Decisões do Felipe (PR #15):** janela de 200 mensagens; OCR até 30 páginas; Gemini via `visao_de_imagem` aprovado; envio de arquivo ao Hub (Q7) **ainda não decidido**.

## O que mudou para o atendente

- A análise e a ficha leem o **conteúdo** do anexo (texto do PDF, OCR de PDF escaneado, visão da foto), não só o nome e a legenda.
- Foto de holerite entra como comprovante quando a visão documental extrai valor e trecho. A descrição curta do worker ("parece um extrato") **não** libera confirmação.
- PDF com senha pede a senha no painel. A senha vive só na sessão (até 3 tentativas). Não é gravada.
- Conversa longa não devolve mais 422. Lê as **200 mensagens mais recentes** (sem filtro de “úteis”).
- **Q7 pendente:** o código ainda anexa URL assinada de 15 minutos **só se** o schema da ferramenta tiver `arquivos`/`anexos`. Sem decisão do Felipe, não inventamos multipart nem endpoint novo. Sem o campo, o job segue só com o JSON.

## Limites (padrão)

| Recorte | Valor | Por quê |
|---|---|---|
| Mensagens lidas | 200 mais recentes | Pedido do Felipe. Sem filtro. Sem 422. |
| PDFs reabertos | 12, até 20 MB | Extrato de 30 páginas escaneado no WhatsApp (~0,5–0,7 MB/página) + RG/holerite |
| Fotos na visão | 8, até 8 MB | Cada uma é chamada paga |
| OCR de PDF | 30 páginas | Extrato bancário longo (pedido do Felipe) |
| Lote no fallback | 5 páginas/chamada | Caminho feliz = 1 chamada com o PDF. Raster: no máximo 6 chamadas, não 30 |
| Texto | 120 mil/arquivo, 200 mil no conjunto | ~4 mil caracteres/página × 30; cabe um extrato + RG + holerites |
| Ficha por anexo | 20 mil | O Hub classifica; não precisa do extrato inteiro |
| Token da prévia | 500 mil | 120 mil não cabia o texto de um extrato de 30 páginas |
| URL assinada | 15 min | Só entra se o Hub anunciar o campo (Q7 aberto) |
| Senha | 3 tentativas | Pedido do plano |

Afinar sem migration: `organizations.settings.locacao.anexos` (jsonb). Valor inválido cai no padrão. Sem tela de configuração nesta fase.

## Decisões técnicas

- Ponto de IA: **`visao_de_imagem` aprovado pelo Felipe** (Gemini do menu Provedores). Sem `painel_documento`. PDF escaneado vai primeiro como `application/pdf`; raster de página em lotes de 5 só se isso falhar (e se `@napi-rs/canvas` existir).
- Texto da mensagem: `textoCombinadoDaMensagem` junta legenda + derivado. Nunca `body ?? derivado`.
- A leitura documental da prévia **não é gravada** no banco (Fase 3). O token da prévia leva um mapa path→texto só para a confirmação não chamar a visão de novo (e não divergir o hash).
- Arquivo no Hub (Q7): **pendente**. Comportamento atual permanece. Sem decisão, não muda.
- Storage/Drive/pasta do processo: **Fase 3b**. Não implementado.

## O que a próxima sessão NÃO deve fazer

- Não criar bucket `locacao-processos` (3b).
- Não gravar senha de PDF.
- Não logar CPF, nome ou texto extraído.
- Não alterar Brisa Hub, VPS, tag ou imagem.
- **Não inventar contrato de arquivo com o Hub** enquanto Q7 estiver aberto. Deixar o comportamento atual.

## Living System Checklist

1. Quem me alimenta? Mensagens da conversa + `whatsapp-media` + ponto `visao_de_imagem`.
2. Quem eu alimento? Prévia da análise, ficha temporária, e (se anunciado — Q7 aberto) `iniciar_analise_inquilino`.
3. Registro: `ai.painel_atendente.analise` / `.ficha` — sem PII. Custo em `llm_calls` com `purpose=visao_de_imagem`.
4. Tela: `PainelDoAgente` (aviso de senha, limites, prévia).
5. Porta: Inbox → Painel do agente (já existia).
6. Anti-morte: pendência visível; senha errada não derruba o painel; 3 falhas deixam o arquivo pendente.
7. Configuração: Provedores (`visao_de_imagem`) + jsonb opcional de limites.
8. Continuidade: o atendente confere a prévia; a IA não confirma sozinha.
9. Laço: descrição genérica não libera; conversa que muda invalida o token (409).
10. Mapa: `docs/architecture/painel-acoes-hub.architecture.json` (nós `anexos`, `visao`, `storage`).
