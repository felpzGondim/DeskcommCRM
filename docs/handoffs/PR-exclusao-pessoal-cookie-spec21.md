# Spec 21 — cookie mídia/documentos (PR deste corte)

MERGE CANDIDATE deste trabalho: **só** a exclusão pessoal nas rotas cookie.
Sem schema, sem 0773, sem OAuth, sem hook, sem grant.

O PR experimental `#49` (`cursor/revisao-exclusao-pessoal-delegacao-92ad`) **permanece
experimental, NÃO é MERGE CANDIDATE**. Artefatos M1/M2, migration 0773, harness e
rotas 404 de delegação ficam lá. Este corte **não** reescreve, não fecha e não
force-push essa branch.

## O que entra aqui

- Helper fail-closed `lib/auth/exclusao-contato-pessoal.ts`
- `GET app/api/v1/messages/[id]/media/route.ts` — recusa antes de `createSignedUrl` / fetch do provedor
- `GET|PATCH app/api/v1/conversations/[id]/locacao/documentos/route.ts` — mesmo helper no `contexto`; PATCH pessoal não grava
- Testes sintéticos (execução, não só grep): org errada, papel, outra conversa, sem conversation_id, erro de query, `is_personal` malformado, sem assinar/fetch/write
- Fragmento `.changes/exclusao-pessoal-midia-documentos.md`

Irmã `notes/[noteId]/media` **não** patchada (teste em `contato-pessoal-lista.test.ts` afirma a ausência).

Auth: cookie + org ativa + RLS da sessão. Sem path público, sem auth-dual, sem alargar GRANT.

## O que NÃO entra

0773, `baseline.sql`, `delegacao_*`, harness GoTrue, metadata OAuth, rotas MCP/delegação, CREATE ROLE, hook, grant.

## Plano — próximo incremento REAL de papel dedicado (NÃO implementar neste PR)

M1 no Auth **descartável** (tag `v2.196.0` compilada, não digest da imagem de produção) passou 12/12: o runtime **pode** emitir `role=oauth_delegado`. Isso **não** é preparação de produção.

Falta, em ordem mínima (cada item é aprovação à parte; nenhum entra neste PR):

1. Hook Custom Access Token **ligado no Auth da instalação** (não só SQL de fixture) — copia claims; mapeia **um** `client_id` sintético/aprovado para o papel dedicado; cookie/password sem `client_id` ficam `authenticated`.
2. `CREATE ROLE` dedicado `NOINHERIT` + `GRANT <papel> TO authenticator` + `USAGE` em `public` — sem isso PostgREST não faz `SET ROLE`.
3. Policies **`TO` esse papel** (não só `TO authenticated`) + policy na tabela de grant; inventário de `GRANT … TO PUBLIC` (PUBLIC alcança `NOINHERIT`).
4. Verificador de Bearer OAuth: no experimento (#49) `verificarSujeitoOAuth` recusa `role !== "authenticated"`. Um JWT `oauth_delegado` do M1 seria recusado na app até essa escolha mudar. Este PR cookie **não** traz esse verificador.
5. Prova de **Storage com RLS ligada** no Postgres do CI (stub local tem `storage.objects` sem RLS; skip ≠ prova).
6. RPC `SECURITY DEFINER` executável por `authenticated` continua herdada enquanto o JWT for o mesmo papel da cookie — revogar EXECUTE quebra a Inbox.

TRUNCATE: RLS **não** governa `TRUNCATE`. Um `FOR ALL` de policy **não** cobre TRUNCATE. Auditoria de ACL de `TRUNCATE`/`GRANT` é superfície **separada**, não inferência deste helper.

Custo qualitativo do incremento 1–3: schema (tripla migration+baseline) + config Auth da instalação + invariantes pg15/17 no ACL **real** do CRM. Dependência: decisão de produto (papel terceiro vs restritivas em `authenticated`). Não misturar com spec 21.
