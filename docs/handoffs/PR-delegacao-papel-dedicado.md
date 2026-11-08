# Handoff — papel dedicado (PR deste corte)

REVIEW. Sem merge/tag/deploy/VPS. Sem 0773. Sem transportar o pacote experimental #49.
#50 (cookie spec 21) permanece independente e já na main.

## O que entra

- Migration `0774` + apêndice no `baseline.sql`
- Papel `oauth_delegado` NOINHERIT, GRANT ao `authenticator`
- Hook SQL versionado por `delegacao_clientes_autorizados` (vazia = copia claims)
- Grant `delegacao_visibilidade_corporativa` (vazio; individual; buscar/ler/baixar)
- Conta empresarial + vínculo de sessão (vazio; inclusão/substituição herda; pessoal/unknown recusam)
- Policies **TO** o papel em conversas/mensagens/contatos/documentos/storage
- RLS ligada em `storage.objects`; policies de storage sem `TO` recortadas para `authenticated`. ENABLE 42501 com RLS off **aborta** antes de GRANT SELECT (já ON: não ALTER).
- HTTP `/api/mcp/delegacao` (Bot, Bearer individual) + RFC 9728
- Cadastro mínimo: `PUT/DELETE /api/v1/channel-sessions/:id/conta-empresarial` (cookie + admin). POST de número novo **não** classifica — sessão nasce desconhecida até o vínculo oficial.
- Verifier `role=oauth_delegado` (recusa cookie/`dsk_`)
- Invariantes RLS + herança de sessão + rollback de catálogo
- Cadeia viva GoTrue `v2.197.0` (SHA `4eee58f296d9698a1c2c0ae14d7a0b379c7622d3`) + PostgREST HTTP (PKCE+refresh → JWT `oauth_delegado` → só conversa corporativa da identidade)
- `tests/e2e/delegacao-mcp-next.spec.ts` (`SPECS_PARTE_7`): tools/call buscar/ler/baixar **no processo Next**, duas identidades, negativos pessoal/unknown/outra org/grant CRM revogado. Recusa 401/well-known/cookie **não** conta como cadeia positiva. GET com JWT dedicado prova identidade no Next; tools/call prova PostgREST/Storage. Client JWT: `accessToken` do SDK (anon key sozinha SET ROLE `anon`).
- Fragmento `.changes/delegacao-papel-dedicado.md` (`nada_mudou` = sem ação do operador na VPS agora)

## O que NÃO entra

0773, DCR, mensagem a terceiros, semente de grant/client/conta/sessão de produção,
`GOTRUE_*` em `lib/env.ts`, rewrite de commits, force-push, merge/deploy/tag,
confirmação de números reais, allowlist estática por pessoa.

## Allowlist / estados (CONFIRMADO)

| Conjunto | Vazio | Não-vazio |
|---|---|---|
| `delegacao_clientes_autorizados` | hook copia claims; cookie `authenticated` | `client_id` vivo → `oauth_delegado` |
| `delegacao_visibilidade_corporativa` | grant ausente = recusa | uid+client+org+efeitos vivos autorizam |
| `delegacao_sessoes_empresariais` | sessão desconhecida = recusa | vínculo vivo + conta viva = origem empresarial (herda) |

Empty client allowlist **não** desfaz recast nem RLS de storage.

## Recuperação

Snapshot de catálogos, não dump de conversa/storage. `agent.sh` não reverte DB.
Backups gerenciados: **não verificados**; não se conclui ausência.
