# Handoff — papel dedicado (PR deste corte)

REVIEW. Sem merge/tag/deploy/VPS. Sem 0773. Sem transportar o pacote experimental #49.
#50 (cookie spec 21) permanece independente.

## O que entra

- Migration `0774` + apêndice no `baseline.sql`
- Papel `oauth_delegado` NOINHERIT, GRANT ao `authenticator`
- Hook SQL versionado por `delegacao_clientes_autorizados`
- Grant `delegacao_visibilidade_corporativa` (vazio)
- Policies **TO** o papel em conversas/mensagens/contatos/documentos/storage
- RLS ligada em `storage.objects`; policies de storage sem `TO` recortadas para `authenticated`
- Verifier `role=oauth_delegado` (recusa cookie/`dsk_`)
- Invariante `tests/invariants/delegacao-papel-dedicado-rls.test.ts` (pg do harness)
- Fragmento `.changes/delegacao-papel-dedicado.md` (`nada_mudou` = sem ação na VPS agora)

## O que NÃO entra

HTTP de delegação, DCR, 0773, harness GoTrue, mensagem a terceiros, semente de
grant/client, `GOTRUE_*` em `lib/env.ts`, rewrite de commits, force-push.

## Prova vs skip (medido nesta rodada)

| Gate | Resultado |
|---|---|
| `pnpm test:db` pg15 `delegacao-papel-dedicado-rls` | 22 passed, 0 skipped, 0 failed |
| `pnpm test:db` pg17 mesmo arquivo + `hardening-definer-varredura` | 27 passed, 0 skipped |
| Cookie recast: `rls-isolation` + `locacao-processos-rls` + `rls-completude-varredura` | 260 passed |
| Baseline install + update `ON_ERROR_STOP=1` | ok (idempotente) |
| Sabotagem: `is_personal is false` → `true` na policy de conversa | o caso "identidade A vê só corporativa" falhou (esperado 1, veio 0); revertido |
| Storage RLS | `relrowsecurity = true` é assert; skip ≠ prova |
| Auth vivo (GoTrue hook ligado) | **NÃO MEDIDO** nesta instalação; SQL do hook + SET ROLE do authenticator sim |

Cookie pessoal continua legível em `authenticated` (controle). HTTP de delegação não nasce (404).

## Auth vivo

M1 no descartável já mostrou emissão. Este PR exercita a função SQL do hook e o
`SET ROLE` no Postgres do CI (caminho PostgREST). Ligar o hook no Auth da
instalação é o passo de coordenação, não desta rodada.

## Staging / backup / rollback (ensaiado em SQL, não aplicado em produção)

Backup: dump lógico das duas tabelas novas (vazias) + `pg_roles` / `pg_policies`
filtrado por `oauth_delegado`. Rollback: `revoke oauth_delegado from authenticator;`
deixa o PostgREST sem SET ROLE; allowlist vazia já zera o hook. Não dropar o
papel num update.sh a meio — o apêndice é idempotente.
