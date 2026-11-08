# HANDOFF — exclusão pessoal em mídia/documentos + delegação (revisão)

> Diário desta correção. Não é contrato de produto. A verdade está em
> [`docs/decisoes/delegacao-analise-inquilinos.md`](../decisoes/delegacao-analise-inquilinos.md),
> [`docs/decisoes/delegacao-transporte-identidade.md`](../decisoes/delegacao-transporte-identidade.md)
> e no código. **A integração delegada NÃO está disponível.** Sem merge,
> deploy ou credencial.

## Estado

- Branch de revisão a partir de `origin/main`.
- Peça 1 **implementada em código, não em produção:** 404 fail-closed de
  contato pessoal / prova ausente em `GET /api/v1/messages/[id]/media` e
  `GET|PATCH .../locacao/documentos`, antes de assinar URL ou buscar no
  provedor. Fluxo operacional (`is_personal === false`) permanece.
- Peça 2 **só guarda + testes + contrato:** `lib/auth/delegacao-empresarial.ts`.
  Ativação padrão desligada. Entitlement de visibilidade corporativa vazio
  (`visibilidade_nao_ativada`). Fora do catálogo MCP.
- D3/D5 **alvo decidido (Felipe, 08/11/2026 13:12 São Paulo), não ativado:**
  buscar/ler/baixar em todas as conversas corporativas da org imobiliária.
  Não assigned-only, não só o turno. Exclui outras empresas, WhatsApp/sessão
  pessoal, chats privados do bot.
- Sem migration, sem `.env` nova, sem token, sem allowlist de sessão, sem
  papel novo, sem WhatsApp real, sem dado de cliente.
- Irmã `notes/[noteId]/media` **não** patchada (documentada).

## O que NÃO foi feito (de propósito)

- Merge, tag, release, `update.sh`, imagem, banco vivo.
- `auth-dual` ou path público nas rotas de mídia/documentos (alargaria auth).
- Registrar tools MCP novas (o token `dsk_` + admin client não é a atendente).
- Alterar `fn_conversation_scope` / `conversations_select`.
- Classificar sessões de canal como corporativas por omissão.
- Emitir entitlement / credencial / cookie de outra conta.
- Hardcode de usuário, org de cliente ou session id.

## Como retomar

1. Ler a decisão (contrato, D1–D5, checklist) e o transporte.
2. Rodar os testes listados no PR. Sabotagem anterior: omitir
   `conversaTemContatoPessoal` da rota de mídia fez
   `404 sem assinar e sem provedor` cair (302). Restaurado.
3. Não tratar `autorizarDelegacaoEmpresarial` com flags do chamador como
   auth completa: o `ok: true` é inalcançável sem entitlement concedido.
4. Não ligar `ativacao.ativa` nem gravar grant sem D1/D2/D4 e aprovação
   do entitlement.

## Itens abertos

- D1 transporte (capacidades do Bot Análise não medidas).
- D2 fonte de sessão corporativa.
- D4 quem grava entitlement / liga a org.
- Implementação da superfície `/api/v1/delegacao/*` e da tabela de grant.
- Irmã notes/media, se o produto quiser o mesmo 404.
