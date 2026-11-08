# Restaurar config do Auth (externa ao catálogo 0774)

O SQL `0774_delegacao_papel_dedicado.sql` reverte papel, policies, ACL, membership e o **texto** do hook. **Não** reverte a config do processo Auth (`GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_*`). Troca de imagem / `agent.sh` **não** é restore de banco nem desta config.

Este corte **não liga** o hook. Só use estes passos se alguém o tiver ligado à parte, **antes** de qualquer reativação.

## Pré-condições

1. Backup lógico do catálogo (`0774_snapshot_catalogo.sql`) feito **antes** da 0774.
2. `storage.objects.relrowsecurity` medido. Se já era ON, o rollback SQL **não** desliga RLS (desligar seria mudar o produto, não desfazer 0774). Stub de harness que nascia OFF e a 0774 ligou: ratchet de um sentido — permanece ON.
3. Sem dados reais / PII nesta prova.

## Ordem (fail-closed)

1. **Não** ligue o hook de novo. Se o processo Auth ainda aponta para o hook, desligue a flag **antes** de aplicar o SQL de rollback (senão o Auth chama função já dropada).
2. Aplique `supabase/rollback/0774_delegacao_papel_dedicado.sql`.
3. Restaure a config do Auth a partir do **snapshot de chaves** (não de valores secretos):
   - `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED` — volte ao booleano que estava.
   - `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI` — volte ao URI que estava, ou esvazie se estava desligado.
   - `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS` — **não leia, não imprima, não grave em log**. Recoloque pelo mesmo cofre/arquivo que o operador já usa; se a flag volta a `false`, o secret não é consultado.
4. Recarregue **só o processo Auth** (reinício do serviço Auth). Não recrie o app, não dê rollback de tag/imagem como se fosse DB.
5. Confira `GET /auth/v1/health` e um login cookie: `role` continua `authenticated` com allowlist vazia.

## Pré-flight live — três inventários independentes

Não misturar. Cada um tem snapshot/prova própria; o resultado de um não vale pelo outro.

| Inventário | Independente de | O que conferir |
|---|---|---|
| Catálogo SQL (policies, ACL, papel, hook **texto**) | Revoke Auth, ENABLED/URI, grants CRM | `0774_snapshot_catalogo.sql` pré == pós-rollback (ratchet RLS storage ON) |
| Config Auth (ENABLED / URI; **não** SECRETS) | Catálogo SQL, `revoked_at` | Snapshot de **chaves**, não de valores secretos. `agent.sh`/imagem ≠ restore |
| Grant CRM `revoked_at` | Access JWT até `exp`, catálogo, config Auth | Efeito instantâneo no MCP/RLS. Logout/revoke Auth **não** mata o access JWT |

## O que isto não é

- Restore de dump de conversa ou de objeto Storage.
- `docker compose pull` / retag / `agent.sh`.
- Religar o hook. Religar é decisão de ativação, depois do catálogo estável.
