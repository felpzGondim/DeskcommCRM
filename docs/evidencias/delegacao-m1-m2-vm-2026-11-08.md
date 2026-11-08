# Evidência M1/M2 — VM descartável 2026-11-08

Não é produção. Não liga hook/grant no produto. Sem merge/tag/deploy.

- **Quando:** 2026-11-08T17:59:53Z
- **Checkout:** `3d19b9740ec89190a19485f7f611c2ce3a7fd5df`
- **GoTrue git:** `0204331ca41a5b49f076b6fa3dc6c0d20b996590` (tag v2.196.0)
- **GoTrue binário sha256:** `69ee527c7657b0c9e09c795db7b23807b07d27ca9a6fa7d54e9bc3c3414e3a7c`
- **Postgres:** 16.15 local (apt). **Docker:** ausente. **Imagem gotrue:** não puxada (compilado da tag).
- **M1 exit:** 0 — pass=12 fail=0 skip=0
- **M2 synth exit:** 0 — pass=25 fail=0
- **M2 baseline apply exit:** 0
- **M2 invariantes delegacao-* exit:** 0

## M1 casos (claims não-sensíveis)

- `PASS` `m1.signup` {"status": 200, "has_user": true}
- `PASS` `m1.password_grant` {"role": "authenticated", "has_sub": true, "sub_eq_user": true, "has_client_id": false, "client_id_eq_expected": true, "has_session_id": true, "iss": "http://127.0.0.1:9888/auth/v1", "iss_eq_expected": true, "aud": "authenticated", "jose_ok": true}
- `PASS` `m1.password_get_user` {"status": 200, "id_match": true}
- `PASS` `m1.register_client_mapped` {"client_id": "7d006601-7c40-460d-8e2d-cc4f4f243f0a"}
- `PASS` `m1.register_client_control` {"client_id": "f2915598-499b-47f2-981d-da0e3ce1d7ad"}
- `PASS` `m1.oauth_pkce_mapped` {"role": "oauth_delegado", "has_sub": true, "sub_eq_user": true, "has_client_id": true, "client_id_eq_expected": true, "has_session_id": true, "iss": "http://127.0.0.1:9888/auth/v1", "iss_eq_expected": true, "aud": "authenticated", "jose_ok": true}
- `PASS` `m1.oauth_mapped_getClaims` {"role": "oauth_delegado", "has_sub": true, "sub_eq_user": true, "has_client_id": true, "client_id_eq_expected": true, "has_session_id": true, "iss": "http://127.0.0.1:9888/auth/v1", "iss_eq_expected": true, "aud": "authenticated"}
- `PASS` `m1.oauth_mapped_getUser` {"id_match": true, "has_error": false}
- `PASS` `m1.oauth_refresh_mapped` {"role": "oauth_delegado", "has_sub": true, "sub_eq_user": true, "has_client_id": true, "client_id_eq_expected": true, "has_session_id": true, "iss": "http://127.0.0.1:9888/auth/v1", "iss_eq_expected": true, "aud": "authenticated", "jose_ok": true}
- `PASS` `m1.oauth_pkce_other_client` {"role": "authenticated", "has_sub": true, "sub_eq_user": true, "has_client_id": true, "client_id_eq_expected": true, "has_session_id": true, "iss": "http://127.0.0.1:9888/auth/v1", "iss_eq_expected": true, "aud": "authenticated", "jose_ok": true}
- `PASS` `m1.oauth_omit_client_id` {"role": "authenticated", "has_sub": true, "sub_eq_user": true, "has_client_id": false, "client_id_eq_expected": true, "has_session_id": true, "iss": "http://127.0.0.1:9888/auth/v1", "iss_eq_expected": true, "aud": "authenticated"}
- `PASS` `m1.password_unaffected_after_hook` {"role": "authenticated", "has_sub": true, "sub_eq_user": true, "has_client_id": false, "client_id_eq_expected": true, "has_session_id": true, "iss": "http://127.0.0.1:9888/auth/v1", "iss_eq_expected": true, "aud": "authenticated"}

Fixture IDs (não são tokens):
- user_id `d8dd6a6b-5c70-45e7-981e-bc5a476023d0`
- mapped_client_id `7d006601-7c40-460d-8e2d-cc4f4f243f0a`
- control_client_id `f2915598-499b-47f2-981d-da0e3ce1d7ad`

## M2 sintético (últimas linhas)

```
DO
psql:/agent/repos/DeskcommCRM/scripts/disposable-delegacao-auth/m2-acl.sql:434: NOTICE:  PASS m2.cookie_write_unaffected
DO
psql:/agent/repos/DeskcommCRM/scripts/disposable-delegacao-auth/m2-acl.sql:447: NOTICE:  PASS m2.authenticator_switch_reads_corp
DO
                       id                       | ok |                     detail                     
------------------------------------------------+----+------------------------------------------------
 m2.authenticator_set_role_after_grant          | t  | oauth_delegado
 m2.authenticator_set_role_denied_without_grant | t  | permission denied to set role "oauth_delegado"
 m2.authenticator_switch_reads_corp             | t  | 1
 m2.cookie_documents_allowed                    | t  | cookie documents
 m2.cookie_felipe_sees_personal                 | t  | cookie admin sees personal
 m2.cookie_marina_sees_org                      | t  | cookie membership sees all kinds in org
 m2.cookie_storage_allowed                      | t  | cookie storage
 m2.cookie_write_unaffected                     | t  | 1
 m2.definer_authenticated_only                  | t  | DEFINER grant is per-role, not PUBLIC
 m2.helpers_stable                              | t  | fn_user_org_ids and auth.uid are STABLE
 m2.no_authenticated_membership                 | t  | oauth_delegado must not inherit authenticated
 m2.oauth_denies_other_org                      | t  | org B
 m2.oauth_denies_personal                       | t  | personal
 m2.oauth_denies_unknown                        | t  | unknown
 m2.oauth_documents_denied                      | t  | documents default deny
 m2.oauth_grant_sees_corp_only                  | t  | mapped grant + corp
 m2.oauth_identity_without_grant                | t  | felipe has other client grant
 m2.oauth_revoked_grant                         | t  | revoked
 m2.oauth_storage_denied                        | t  | storage
 m2.oauth_unapproved_client                     | t  | unknown client
 m2.oauth_write_denied                          | t  | 0
 m2.public_execute_reaches_authenticated        | t  | PUBLIC also reaches cookie role
 m2.public_execute_reaches_dedicated            | t  | PUBLIC ignores NOINHERIT
 m2.revoke_public_drops_dedicated               | t  | after revoke PUBLIC
 m2.usage_public_granted                        | t  | USAGE on public
(25 rows)

 pass | fail | total 
------+------+-------
   25 |    0 |    25
(1 row)

DO
```

## M2 invariantes CRM (cauda)

```
(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - ESM syntax in a file loaded as CommonJS (vitest.db.config.ts:1:1). Use a `.mjs` extension or set `"type": "module"` in the closest package.json
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.

 RUN  v4.1.11 /agent/repos/DeskcommCRM

psql:<stdin>:4: ERROR:  new row violates row-level security policy for table "messages"
psql:<stdin>:3: ERROR:  permission denied for function fn_delegacao_probe_publico

 Test Files  3 passed (3)
      Tests  27 passed (27)
   Start at  17:59:50
   Duration  3.51s (transform 78ms, setup 507ms, import 78ms, tests 2.61s, environment 0ms)

```

## Cleanup (verificado depois do trap)

- DBs `m1_auth` / `m2_*` / `inv_baseline`: **0** restantes.
- Roles `oauth_delegado` / `supabase_auth_admin` / `authenticator`: **0**.
- `$WORKDIR/secrets`: apagado.
- Processo GoTrue: morto.

## Arquitetura (medido vs produto)

| | Descartável | Produto (este PR) |
|---|---|---|
| Auth emite `role=oauth_delegado` no code+PKCE e no refresh | **sim** (M1 12/12) | hook **não** ligado |
| Cookie/password sem `client_id`, `role=authenticated` | **sim** | n/a |
| Output do hook sem `client_id` (replace) | **sim** — claim ausente | n/a |
| PUBLIC EXECUTE alcança papel NOINHERIT | **sim** | intacto |
| `authenticator` SET ROLE sem GRANT | **recusa** (`SET SESSION AUTHORIZATION`) | sem papel dedicado |
| Policies TO `oauth_delegado` + policy no grant | isolam corp/pessoal/org/client/revogado | 0773 **unapplied**; policies são TO `authenticated` |
| `storage.objects` RLS neste stub | **off** (`false`) — 0773 não cria `oauth_cookie_only` | igual no `test:db` (prelude não ENABLE RLS) |
| HTTP delegação | n/a | **404** |
| `verificarSujeitoOAuth` | n/a | ainda exige `role=authenticated` |

Go toolchain do binário: `GOTOOLCHAIN=auto` → **go1.26.5** (go.mod do Auth). Docker ausente; imagem `supabase/gotrue:v2.196.0` **não** puxada.

CI no snapshot **antes** deste push (`3d19b9740e`): `verify` success; `invariants-majors` 15/17 **in_progress**; `e2e` in_progress. Sem poll depois.
