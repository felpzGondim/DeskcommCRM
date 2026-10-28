# Release deste fork — CHANGELOG no PR da feature e retag da tag

**Status:** aprovado pelo dono em 28/10/2026 12:56; implementado neste PR.
**Âmbito:** fork `felpzGondim/DeskcommCRM`. Sem deploy, sem VPS, sem ligar chave.
**Origem:** proposta em [`ci-velocidade-proposta.md`](./ci-velocidade-proposta.md) §§2.1 e 2.2.
**Operação:** [`docs/deploy-fork.md`](../deploy-fork.md).

---

## 1. CHANGELOG datado no PR da feature

Não existe mais PR cujo único efeito é trocar `não publicada` pela data. A felpz.9 e a felpz.10 pagaram ~22 min de `invariants-majors (17)` por uma linha.

**Processo:**

1. O PR da feature (ou o PR que junta as features da revisão) já traz a seção
   `## [X.Y.Z-felpz.N] — AAAA-MM-DD` no `CHANGELOG.md`, com a data do dia.
2. CI verde, merge autorizado.
3. A tag anotada `vX.Y.Z-felpz.N` nasce **no merge commit dessa feature**
   (`git tag -a` no SHA do merge, `git push origin vX.Y.Z-felpz.N`).
4. O push da tag dispara `publish-image.yml` como hoje.

Não há `workflow_dispatch` extra para criar a tag: a pessoa que já empurrava a
tag à mão continua fazendo isso, agora no merge da feature, sem o PR do meio.
Um dispatch que commitasse a data ainda pagaria o CI desse commit.

**Checagem:** `tests/unit/changelog-do-fork-nasce-datado.test.ts` reprova cabeçalho
`felpz.N` sem `YYYY-MM-DD`. `não publicada` deixou de ser formato aceito.

A guarda `a-tag-veio-da-main` não muda: a tag só publica se o commit estiver
contido na `main` (`identical` ou `behind`).

---

## 2. Retag: a tag reusa o manifesto que a main já publicou

O push na `main` e o push da tag do **mesmo SHA** compilavam as quatro imagens
nas duas arquiteturas. Na felpz.9 isso foram ~4–7 min de fila + 8 builds
duplicados, com a tag saindo 22 s depois do merge.

**O que mudou:**

- O `docker/metadata-action` de `build-and-push` e de `juntar-manifestos` passa
  a emitir `type=sha,format=long`. O push da `main` deixa no GHCR o índice
  `ghcr.io/<dono>/<img>:sha-<commit>` com `linux/amd64` e `linux/arm64`, e as
  pernas `-amd64`/`-arm64`.
- Job novo `esperar-sha-da-main`, **sem** `if:` de job (pulá-lo pulava
  `build-and-push`). Fora de tag sai em segundos com `reusar=nao`. Em tag,
  espera até 22 min o índice das quatro imagens com as duas arquiteturas.
- Só reusa quando **tudo** isto vale, senão cai no `build-and-push` atual:
  1. `a-tag-veio-da-main` aceitou (`identical`|`behind`) — a tag está na `main`.
  2. `tag^{}` é o `GITHUB_SHA` do run (commit da tag anotada).
  3. O manifesto `sha-<esse SHA>` existe no GHCR **para as quatro imagens**,
     cada um com `linux/amd64` **e** `linux/arm64`. Falta uma perna → `nao`.
- Reuso = `docker buildx imagetools create --tag <tags da versão> <origem sha-arch>`
  nas células de worker, scheduler e voice-agent. A imagem do **app**
  (`deskcommcrm`) **sempre reconstrói** na tag, mesmo com `reusar=sim`:
  `APP_VERSION` é assada no build e é o que `rollbackDesmentidoPeloApp`
  compara com `to_version`. Retaggear o app deixaria o SHA curto da main;
  um `update.sh --force` da mesma versão não desmentiria o rollback e a
  tela bloquearia a próxima atualização.
- `imagem-do-app-sobe` e `imagens-de-fundo-sobem` **não** esperam esse job:
  o smoke da tag continua em paralelo, construindo local como hoje, e
  `promover-stable` ainda precisa dos dois. Nada de promover `stable` sem smoke.

Nenhuma checagem existente foi removida: pg17, e2e, arm64, `imagens-ok`, a
trava de procedência e o smoke antes do `stable` continuam.

### Como conferir na próxima release

Depois do merge da feature e do push da tag `vX.Y.Z-felpz.N`:

1. No run de `publish-image` da **tag**, o job `esperar-sha-da-main` deve
   imprimir `reusar=sim` (ou `nao` + o build atual, se a main ainda não
   publicou o SHA — aí não é regressão, é o fallback).
2. Com `reusar=sim`, as células de worker/scheduler/voice-agent mostram
   **“Retag da imagem que a main já publicou neste SHA”**; as duas do
   **app** (`deskcommcrm`) mostram **Build e push** — o número da release
   tem de ir em `APP_VERSION`.
3. Digest da versão = digest de `sha-<merge>` **nas três imagens de fundo**.
   O app difere (camada `APP_VERSION`). `stable` continua igual à versão.

   ```bash
   for img in deskcomm-worker deskcomm-scheduler deskcomm-voice-agent; do
     echo "== $img =="
     docker buildx imagetools inspect "ghcr.io/felpzgondim/${img}:<X.Y.Z-felpz.N>" | grep Digest
     docker buildx imagetools inspect "ghcr.io/felpzgondim/${img}:sha-<merge SHA>" | grep Digest
   done
   ```

---

## 3. Um PR de banco por vez

Prática deste fork, também em `AGENTS.md`: não abrir o segundo PR com migration
enquanto o primeiro estiver aberto. Dois PRs de schema colidem no `NNNN`, no
timestamp e no apêndice do `baseline.sql`; os dois ficam verdes porque cada um
mediu a `main` do dia em que o `verify` rodou, e o segundo mergeia duplicata.
Quem mede o universo: `pnpm checar:colisao-de-migration`.
