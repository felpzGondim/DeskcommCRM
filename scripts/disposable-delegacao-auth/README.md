# Harness descartável M1 (GoTrue) + M2 (ACL/RLS)

Ambiente **temporário** nesta VM (ou CI efêmero). Não aponta para VPS, não
liga hook/grant no produto, não cria cliente OAuth real, não faz merge/deploy.

Autorização (Análise 08/11/2026): testes de autenticação e permissões com
dados fictícios, sem alterar produção.

## O que corre

1. **M1** — binário GoTrue compilado da tag pública `v2.196.0`
   (`0204331ca41a5b49f076b6fa3dc6c0d20b996590`) + Postgres 16 local.
   Hook `pg-functions` **só neste banco**. Fluxo real
   `authorization_code` + PKCE + refresh. Assinatura via `jose` e
   `getClaims`/`getUser` do SDK. Segredos em `/tmp/disposable-delegacao/secrets`
   (mode 700/600); o script **nunca** imprime password, code, keys, access
   ou refresh.
2. **M2** — SQL sintético (PUBLIC / `authenticator` SET ROLE / policies TO
   papel dedicado) e, se o baseline aplicar, os três invariantes
   `tests/invariants/delegacao-*.test.ts` contra Postgres local (sem Docker).

## Como correr

```bash
bash scripts/disposable-delegacao-auth/run.sh
```

`cleanup.sh` também roda no `EXIT`/`ERR`/`INT` do `run.sh`.

## Fora de escopo

Produto (rotas 404, `ATIVACAO_DELEGADA_PADRAO=false`, migration 0773
não aplicada na instalação viva). Spec 21 (cookie) é independente.
