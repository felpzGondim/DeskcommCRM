# HANDOFF — exclusão pessoal em mídia/documentos + delegação (revisão)

> Diário desta correção. Não é contrato de produto. A verdade está em
> [`docs/decisoes/delegacao-analise-inquilinos.md`](../decisoes/delegacao-analise-inquilinos.md)
> e no código. **A integração delegada NÃO está disponível.** Sem merge,
> deploy ou credencial.

## Estado

- Branch de revisão a partir de `origin/main`.
- Peça 1 **implementada em código, não em produção:** 404 de contato pessoal
  em `GET /api/v1/messages/[id]/media` e `GET .../locacao/documentos`, antes
  de assinar URL ou buscar no provedor.
- Peça 2 **só guarda + testes + contrato:** `lib/auth/delegacao-empresarial.ts`.
  Ativação padrão desligada. Fora do catálogo MCP.
- Sem migration, sem `.env` nova, sem token, sem allowlist de sessão, sem
  papel novo, sem WhatsApp real, sem dado de cliente.

## O que NÃO foi feito (de propósito)

- Merge, tag, release, `update.sh`, imagem, banco vivo.
- `auth-dual` ou path público nas rotas de mídia/documentos (alargaria auth).
- Registrar tools MCP novas (o token `dsk_` + admin client não é a atendente).
- Classificar sessões de canal como corporativas por omissão.
- Hardcode de usuário, org de cliente ou credencial.

## Como retomar

1. Ler a decisão (contrato, D1–D5, checklist de ativação).
2. Rodar os testes listados no PR. Sabotagem feita nesta sessão: omitir
   `conversaTemContatoPessoal` da rota de mídia fez
   `404 sem assinar e sem provedor` cair (302 em vez de 404). Restaurado.
3. Não ligar `ativacao.ativa` sem as respostas de produto.

## Itens abertos

Ver tabela D1–D5 na decisão. Sem isso, o guarda delegado **tem** de recusar
(`sessao_nao_classificada` / `identidade_nao_provada` / `integracao_nao_ativada`).
