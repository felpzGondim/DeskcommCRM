# HANDOFF — exclusão pessoal + delegação OAuth (revisão)

> Diário desta correção. Não é contrato de produto. A verdade está em
> [`docs/decisoes/delegacao-analise-inquilinos.md`](../decisoes/delegacao-analise-inquilinos.md),
> [`docs/decisoes/delegacao-transporte-identidade.md`](../decisoes/delegacao-transporte-identidade.md)
> e no código. **A integração delegada NÃO está disponível.** Sem merge,
> deploy, banco vivo ou credencial.

## Estado

- Branch de revisão a partir de `origin/main`.
- Peça 1 **código, não produção:** 404 fail-closed de contato pessoal /
  prova ausente em mídia e documentos, antes de assinar/buscar.
- Peça 2 **preparada, desligada:**
  - `lib/auth/delegacao-oauth-sujeito.ts` — `getUser` + claims; recusa `dsk_`.
  - `lib/supabase/jwt-usuario.ts` — client anon + Bearer; nunca service role.
  - `lib/auth/delegacao-superficie.ts` — grant + classificação + spec 21;
    sem boolean do chamador; sem peer-binding.
  - `app/api/mcp/delegacao` e RFC 9728 **404** (`ATIVACAO_DELEGADA_PADRAO` falsa).
  - Migration `0773` + apêndice do baseline: grant, coluna de classificação,
    policy extra OAuth; `conversations_select` de cookie exige `client_id` nulo.
    **Não aplicada** a banco de cliente.
- D3/D5 **alvo decidido, não ativado:** buscar/ler/baixar em todas as
  conversas corporativas da org. WhatsApp = fonte de documentos, não canal
  da atendente com o Bot.
- Irmã `notes/[noteId]/media` **não** patchada.

## O que NÃO foi feito (de propósito)

- Merge, tag, release, `update.sh`, imagem, banco vivo, flags GoTrue.
- OAuth authorize/token, DCR, INSERT de grant, seed de sessão.
- Servir RFC 9728 de verdade; ligar a superfície.
- Registrar tools MCP; usar `/api/mcp` admin como veículo.
- `device_code`, AS próprio, JWT mintado, `user_metadata` como auth.
- Hardcode de usuário, org de cliente ou session id.

## Como retomar

1. Ler a decisão, o transporte (capacidade vs enablement) e este diário.
2. Rodar testes unitários da peça 1 e da superfície OAuth (lista no PR).
3. RLS de verdade: `pnpm test:db tests/invariants/delegacao-visibilidade-corporativa-rls.test.ts`
   — não é o `test:unit`.
4. Não tratar `PedidoDelegado` como auth completa.
5. Não ligar ativação nem gravar grant sem o checklist do transporte §5.

## Itens abertos

- Enablement `GOTRUE_OAUTH_SERVER_ENABLED` nesta instalação (não medido).
- Interop callback Grok Bot × GoTrue (adiado, não bloqueia offline).
- Escrita da classificação e do grant (Felipe aprova; sem UI neste PR).
- Irmã notes/media, se o produto quiser o mesmo 404.
