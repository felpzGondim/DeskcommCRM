# Proposta: encurtar a espera entre PR verde e imagem publicada

**Status:** análise. §§2.1 e 2.2 aprovados pelo dono em 28/10/2026 12:56 e
implementados — ver [`release-do-fork.md`](./release-do-fork.md). O restante
deste texto não mudou workflow nenhum.
**Pedido:** dono, 28/10/2026 — a espera entre o PR e a imagem.
**Âmbito:** fork `felpzGondim/DeskcommCRM`. Sem deploy, sem VPS, sem ligar chave.
**Medido em:** 28/10/2026, API `repos/felpzGondim/DeskcommCRM/actions/runs` e `.../jobs`.
**Amostra:** PRs #19, #20, #21; push na `main` dos merges; `publish-image.yml` da tag `v1.88.0-felpz.9`. A tag `v1.88.0-felpz.10` ainda não existia quando este texto foi escrito — a tabela dela fica para conferência depois da publicação (comando no fim).

Este documento não muda CI. Números são da API, não da memória.

---

## 1. O que o relógio mede hoje

Há **três estágios em série** no caminho até a imagem versionada, e um quarto que roda em paralelo e não trava a tag.

| Estágio | O que é | Trava a tag? |
|---|---|---|
| A. CI do PR | `ci` + `e2e` + `perf` + `publish-image` (só constrói) | Sim: branch protection |
| B. CI da `main` depois do merge | os mesmos workflows no push | **Não** — a tag da felpz.9 saiu 24 s após o merge, com o e2e da `main` ainda rodando |
| C. `publish-image` da tag | 4 imagens × amd64+arm64, manifesto, `stable`, release | Sim: é a publicação |
| D. CI da `main` (resto) | e2e ~25 min, invariants ~19 min | Não |

A espera que o dono vê, no fluxo atual (feature → PR de CHANGELOG → tag), é **A do CHANGELOG + C**. A do feature já passou. B e D são custo de runner, não de relógio até a imagem.

### 1.1 Relógio de parede (criação do PR → merge → imagem)

Horários UTC, 28/10/2026.

| Evento | Início | Fim do CI verde (último workflow) | Merge | Gargalo do CI verde |
|---|---|---|---|---|
| PR #19 (CHANGELOG, 1 arquivo) | 11:32:16 | 11:53:55 (`ci`) | 11:59:33 | `invariants-majors (17)` **21m19s** |
| Tag `v1.88.0-felpz.9` | 11:59:57 | 12:14:41 | — | `build-and-push (deskcommcrm, amd64)` **10m28s** (fila 4m36s + build 5m52s) |
| PR #20 (Fases 3–3b) | 13:08:42 | 14:12:36 (`e2e` do 2º head) | 14:18:51 | 1º head vermelho; 2º: `e2e-parte (3)` **26m43s** |
| PR #21 (ferramentas do painel) | 14:27:55 | 15:37:26 (`e2e` do 4º head) | 15:44:59 | 3 heads vermelhos/cancelados; 4º: `e2e-parte (3)` **25m08s** |

Do abrir o PR de CHANGELOG da felpz.9 até a imagem no GHCR: **42 min** (11:32 → 12:14). Desses, 22 min são o `ci` do PR (invariants de um diff de uma linha) e 15 min são o build da tag.

Do merge da feature até a imagem, no fluxo atual, ainda falta o PR de CHANGELOG (~22 min) + a tag (~15 min) ≈ **37 min** depois do merge autorizado. Foi isso que a felpz.10 repetiu: #21 entrou às 15:44 e a imagem versionada só nasce depois deste PR.

### 1.2 CI do PR — fila vs execução, gargalo

Fila do job = `started_at − created_at`. Execução = `completed_at − started_at`. Nos PRs desta amostra a fila dos jobs pesados foi **1–6 s** (runners públicos livres). O relógio é execução.

**Head verde de cada PR** (o que a protection viu):

| Workflow | #19 (docs) | #20 (schema+UI) | #21 (schema+UI) | Gargalo |
|---|---|---|---|---|
| `ci` | 21m36s | 18m43s | 18m24s | `invariants-majors` pg17: 21m19s / 16m01s / 18m06s |
| `e2e` | **9s** (partes puladas: `pr-alcanca-o-e2e.sh` → `nao`) | 27m06s | 25m37s | `e2e-parte` 3 ou 5: ~25–27 min |
| `perf` / `build-and-size` | 4m17s | 3m05s | 4m08s | o próprio build |
| `publish-image` (PR, sem push) | **17s** (builds pulados: CHANGELOG não alcança imagem) | 6m37s | 10m21s | `imagem-do-app-sobe` amd64 6–10 min |

Runs (comando: `gh api repos/felpzGondim/DeskcommCRM/actions/runs/<id>/jobs`):

- #19 `ci` 40680726410, `e2e` 40680726260
- #20 head `09d7bde3f` `ci` 40699371051, `e2e` 40699371071
- #21 head `e6434ddab` `ci` 40713480581, `e2e` 40713480565

`verify-parte` (unit + typecheck/lint/cercas) fica em 4–9 min e **nunca** foi o gargalo. O que segura o check `verify` é o agregador esperando `invariants`.

O #19 prova o desperdício: diff de uma linha no `CHANGELOG.md`, e2e e imagens pulados com razão, e mesmo assim **pg17 `test:db` + `test:db:update` por 21 min**. O alcance do piso (`scripts/pr-mexe-no-piso-do-postgres.sh`) só tira o pg15; o pg17 roda em todo PR. Confirmado no job `invariants-alcance` do #19: 8 s, e em seguida majors (17) 21m19s. pg15 não rodou nesse PR.

Retrabalho por CI vermelho (não entra no “head verde”, mas entra no relógio do dono):

- #20: 1 head vermelho (13:08–13:31, `ci`) + 1 verde. Parede 13:08 → 14:18 = **70 min**.
- #21: 3 heads (vermelho/cancelado) + 1 verde. Parede 14:27 → 15:44 = **77 min**.

`cancel-in-progress` em `pull_request` **já existe** nos jobs pesados (`ci.yml` cabeçalho; `e2e.yml`; `publish-image.yml`). No #21 os heads 255a98aad e 69cedb2ac foram cancelados. Não é alavanca nova.

### 1.3 CI da `main` depois do merge

O push do merge dispara `ci`, `e2e`, `perf` e `publish-image` (este publica `latest`/`main`, não o número da revisão).

| Merge | `ci` | `e2e` | `publish-image` (latest) | Observação |
|---|---|---|---|---|
| #19 → `c0ace5d4` | 19m37s (invariants 17: 19m22s) | 25m50s | 14m00s | Tag saiu 24 s depois; esta rodada **competiu** com a da tag |
| #20 → `9787d8ec` | 21m51s | 30m44s (e2e-parte 5: fila **4m36s** + 25m42s) | 17m11s (deskcommcrm arm64: fila 3m51s + 9m36s) | Fila aparece quando a `main` e o PR #21 disputam runner |
| #21 → `38d96503` | ainda rodava quando esta análise foi escrita | — | — | Confirmar com o mesmo comando abaixo |

Runs: `ci` 40684207556 / 40704703935; `e2e` 40684207650 / 40704703917; `publish-image` 40684207679 / 40704703623.

A `main` **não cancela** `ci`/`e2e` (`cancel-in-progress` só em `pull_request`). `publish-image` na `main` **cancela** (exceção documentada: o produto é `latest`).

Pular B/D não adianta a imagem versionada: a felpz.9 não esperou. Adianta **fila e custo**: no instante da tag, a `main` e a tag construíram as 4 imagens **duas vezes**, no mesmo SHA, e a fila da tag chegou a 4–7 min.

### 1.4 Build/publicação da tag, por arquitetura

Tag `v1.88.0-felpz.9`, run [40684251289](https://github.com/felpzGondim/DeskcommCRM/actions/runs/40684251289). Parede **14m44s** (11:59:57 → 12:14:41).

| Job | Fila | Execução | Total |
|---|---|---|---|
| `a-tag-veio-da-main` | 2m49s | 5s | 2m54s |
| `build-and-push` deskcommcrm **amd64** | 4m36s | 5m52s | **10m28s** ← caminho crítico |
| `build-and-push` deskcommcrm **arm64** | 3m21s | 6m02s | 9m23s |
| `build-and-push` worker amd64 | 1m30s | 1m26s | 2m56s |
| `build-and-push` worker arm64 | 5m15s | 26s | 5m41s |
| `build-and-push` scheduler amd64 | 2m58s | 30s | 3m28s |
| `build-and-push` scheduler arm64 | 4m51s | 28s | 5m19s |
| `build-and-push` voice-agent amd64 | 5m04s | 30s | 5m34s |
| `build-and-push` voice-agent arm64 | 4m19s | 1m03s | 5m22s |
| `imagem-do-app-sobe` amd64 / arm64 | 1m21s / 4m45s | 4m47s / 4m38s | 6m08s / 9m23s |
| `juntar-manifestos` | 2s | 38s | 40s |
| `promover-stable` | 2s | 31s | 33s |
| `publicar-release-do-fork` | 3s | 5s | 8s |

Cache GHA **já existe** (`cache-from/to: type=gha,scope=${{ matrix.name }}-${{ matrix.arch }}`, `mode=max`). Worker/scheduler/voice com cache quente compilam em 26–90 s. O app continua em ~6 min. A fila (3–5 min) é da concorrência com o `publish-image` da `main` no mesmo SHA.

Amd64 vs arm64 no caminho crítico: quase empatados (5m52s vs 6m02s de build). Tirar arm64 **não** corta os 15 min da tag enquanto o app amd64 for o mais longo e a fila permanecer. Cortaria custo de runner (~metade dos jobs de build) e um pouco de fila.

Cache de pnpm/`node_modules`: `.github/actions/preparar-node` já restaura `~/.npm` e `cache: pnpm` do `setup-node`. Não é o gargalo desta amostra.

### 1.5 A VPS Hostinger `srv2017601` é amd64?

**NÃO MEDIDO neste repositório.** `rg srv2017601` no clone é vazio. Nada em `docs/`, compose ou kit grava a arquitetura da instalação do Felipe.

O que dá para afirmar sem SSH:

- As quatro imagens publicadas neste fork são multi-arch (`linux/amd64` + `linux/arm64`); o kit escolhe pela `uname -m` (`hostgator-setup-kit/_manifestos.sh`).
- Planos KVM clássicos da Hostinger são x86_64; a Hostinger também vende VPS ARM. Sem `uname -m` (ou o digest da imagem **em uso** no host) não dá para cortar arm64 com segurança.
- Confirmar: `uname -m` na VPS, ou `docker image inspect` da tag que está no `.env` (`APP_IMAGE`). Não foi feito — este pedido proíbe tocar na VPS.

---

## 2. O que dá para acelerar sem perder checagem

Ganhos em relógio até a imagem versionada, não em minutos de runner. Estimativa = o que a amostra pagou, menos o que a mudança deixaria de pagar. Nenhuma exige desligar verify/e2e/invariants no PR de **código**.

### 2.1 Datar o CHANGELOG no PR da feature (ou tagar o merge da feature)

**Ganho medido: ~22 min por revisão** (o `ci` do PR #19) + o tempo humano de abrir o segundo PR.

A felpz.9 e a felpz.10 pagam um PR cujo único efeito é trocar `não publicada` pela data. O e2e e as imagens já pulam; o `invariants-majors (17)` não. Juntar a nota no PR da feature (como o #18 já fez para a felpz.9, e o #20/#21 não fizeram) elimina o estágio. Alternativa: `workflow_dispatch` que commita a data, espera o CI desse commit se a protection exigir, e cria a tag — um clique, sem PR extra, mas ainda paga o CI se o commit for novo.

Não perde checagem: o diff do CHANGELOG não é o que o e2e/invariants medem.

### 2.2 Não reconstruir a tag quando a `main` já construiu o mesmo SHA

**Ganho medido na felpz.9: ~4–7 min de fila + evitar 8 builds duplicados.** Parede da tag cairia de ~15 min para ~6–8 min se a fila sumisse e o app reusasse o artefato.

No merge #19, `publish-image` da `main` (run 40684207679) e o da tag (40684251289) subiram com 22 s de diferença, no **mesmo** `c0ace5d4`. Os dois compilam as quatro imagens nas duas arches. A doutrina já separa `latest` (main) de `1.88.0-felpz.9`/`stable` (tag); o que falta é **retag** (`docker buildx imagetools create`) do manifesto SHA/`latest` para o número, em vez de `build-and-push` de novo.

Risco a não ignorar: `latest` só é o mesmo SHA se ninguém tiver empurrado a `main` no meio. A guarda já existe (`a-tag-veio-da-main`). Condicionar o retag a `git rev-parse origin/main == tag^{}`.

Não perde checagem: o smoke `imagem-do-app-sobe` / `imagens-de-fundo-sobem` já rodou no push da `main` (e no PR, sem publicar). Na tag bastaria reexecutar o smoke **ou** aceitar o da `main` se o digest for o mesmo.

### 2.3 Pular `invariants-majors` no PR que não toca schema (espelhar o e2e)

**Ganho medido no #19: 21 min.** No PR de CHANGELOG, o check `invariants` passaria em segundos, como o `e2e` já passa.

Hoje: `pr-alcanca-o-e2e.sh` pula e2e em `docs/` e `*.md` da raiz; `pr-mexe-no-piso-do-postgres.sh` só tira o **pg15**. pg17 (`test:db` + `test:db:update`) roda sempre. O cabeçalho do script diz que pg17 “reprova invariante de RLS… que não dependem da versão do Postgres” — verdade para PR de código, não para `CHANGELOG.md`.

A lista de quem **não** alcança schema já está no piso (`supabase/`, `tests/invariants/`, kit, `ci.yml`). Reusar essa lista para pular **as duas** majors, e manter pg17 obrigatório fora de `pull_request` (já é assim). O agregador `invariants` hoje exige majors fora de PR; em PR ele já aceita o recorte do piso.

Não perde checagem no PR de feature com migration: #20 e #21 tocariam `supabase/` e continuariam pagando os ~18 min.

### 2.4 Não repetir e2e/verify na `main` quando a árvore do merge já passou no PR

**Ganho: ~26 min de runner por merge, zero no relógio até a imagem** (a tag não espera). Vale por fila: no merge #20 a `e2e-parte (5)` da `main` ficou **4m36s na fila** enquanto o #21 começava.

O evento `pull_request` mede o merge ref (`refs/pull/N/merge`). Se a `main` não andou desde a base do PR (o próprio `ci.yml` já avisa quando andou), a árvore mesclada é a que o PR mediu. Merge commit tem SHA novo, então “reaproveitar por SHA” não cola — reaproveitar por **tree** (`git rev-parse HEAD^{tree}`) ou por “merge fast-forward / merge commit cujos dois pais já passaram”.

Cuidado já escrito no `ci.yml`: pular o agregador com `skipped` satisfaz branch protection. Na `main` não há protection de merge; o risco é outro — verde sem medir a árvore integrada quando a base andou. A regra segura é: pular só se o cruzamento de arquivos da `main` desde a base do PR for vazio (o passo “A prévia deste PR” já calcula isso).

### 2.5 Cortar arm64 só se a VPS for amd64

**Ganho no relógio da tag: ~0–2 min** (arm64 do app não é o caminho crítico; a fila sim). **Ganho de custo: ~50% dos jobs de build da tag.**

Não fazer até confirmar `uname -m` em `srv2017601`. Se for amd64, ainda assim o fork documenta ARM (`docs/deploy-fork.md`, `docs/runbooks/oracle-arm64.md`). Cortar no workflow deste fork é decisão de produto do Felipe, não de runner. Um meio-termo: publicar arm64 só em `stable`/número, e não no push da `main` (`latest`) — corta a disputa de fila na tag, que é o caso medido.

### 2.6 O que **não** vale a pena nesta amostra

- Ligar `cancel-in-progress` de novo: já está nos jobs pesados do PR.
- Cache GHA/registry “do zero”: já está; worker/scheduler/voice já saem em < 90 s.
- Cache de `next`/`.next` no `verify`: o gargalo do `ci` é Docker+Postgres (`test:db`), não o vitest (4–9 min).
- Build só amd64 sem evidência da VPS.
- Tirar e2e do PR de feature: é o gargalo certo (~25 min) e é a checagem de tela. Recortar partes (já existem 7) rende menos do que não rodar duas vezes (PR + main).

### 2.7 Ordem sugerida (ainda sem mudar workflow)

1. **Processo, zero YAML:** CHANGELOG no PR da feature; tag no merge commit da feature. Corta ~22 min sempre.
2. **Tag não reconstrói o SHA que a `main` acabou de publicar.** Corta fila da tag (4–7 min) e metade dos builds.
3. **Pular invariants no PR que não toca `supabase/` nem kit.** Corta os 21 min do PR de notas.
4. Confirmar arch da VPS; só então discutir arm64.
5. Skip de e2e/verify na `main` por tree idêntica — ganho de fila, não de espera da imagem.

---

## 3. Dois PRs em paralelo e o número da migration

### 3.1 Como o número nasce (CONFIRMADO)

O arquivo é `<timestamp 14 dígitos>_<NNNN>_<slug>.sql`.

- **NNNN** é sequencial no universo `origin/main` **mais todo PR aberto** (inclusive fork). Quem mede: `pnpm checar:colisao-de-migration` (`scripts/checar-colisao-de-migration.sh`). O `ls` do disco mente: um `_2024_` no slug já virou teto falso; um PR aberto já reserva o número sem estar na `main`.
- **Timestamp** é o prefixo. Pode discordar do NNNN (medido na doutrina: `_0230_` com timestamp maior que o `_0231_`). Colisão de timestamp **também** reprova.
- A linha `-- manifest:` mora no `.sql`. **Não** se acresce linha em `MANIFEST.md` (era a fonte de conflito de merge entre PRs de schema).
- O kit self-host aplica **só** `supabase/baseline.sql`. Toda migration nova precisa de apêndice idempotente no **fim** desse arquivo.

### 3.2 O que conflita de verdade

| Superfície | Dois PRs em paralelo | O que acontece |
|---|---|---|
| NNNN igual | Os dois escolhem o “próximo livre” no mesmo instante | `checar:colisao-de-migration` no CI do segundo (depois que o primeiro abriu) **deveria** ver o PR aberto. Se os dois abrem antes de o outro existir, os dois ficam verdes e o segundo mergeia duplicata — a classe da issue #285, agora com vigia na `main` depois. |
| `baseline.sql` apêndice | **Sempre** | Os dois editam o fim do mesmo arquivo. Merge da `main` no segundo PR é conflito textual, mesmo com NNNN diferentes. |
| `lib/database.types.ts` | Quase sempre se os dois tocam schema | Arquivo gerado; conflito mecânico. |
| Código de produto em pastas distintas | Raro | #20 (`lib/locacao`) e #21 (`lib/painel`) conviveram: #21 rebaseou na `main` depois do merge do #20 (`9787d8ec`). |

#20 usou 0763–0768; #21 usou 0769. Não colidiram de número porque foram **em série na `main`**: #21 abriu com a `main` já contendo o #20. Tentativa de empilhar as branches foi abandonada (texto do #21).

### 3.3 Regra simples para este fork

Não precisa de faixa permanente tipo “PR A = 0770–0779”. Precisa de **reserva visível antes de escrever o arquivo**.

1. **Um PR de schema por vez neste fork**, enquanto o ciclo for “feature → CI → merge → tag”. Com 25–70 min de CI, dois schemas em voo pagam o conflito do `baseline.sql` com certeza e o NNNN com alguma chance. É a regra mais barata.
2. Se dois schemas tiverem de andar juntos: **antes de criar o `.sql`**, olhar `pnpm checar:colisao-de-migration` **e** os PRs abertos (`gh pr list --json number,files`). Reservar falando no PR (“este PR leva 0770–0772”). O segundo começa em 0773, mesmo que o primeiro ainda não tenha mergeado.
3. **Quem mergeia depois rebaseia o apêndice do `baseline.sql`**, nunca o `.sql` já aplicado. Forward-fix se o número foi tomado na `main` no meio do voo (o CI de colisão na prévia vs `main` atual já reprova número tomado).
4. Timestamp: usar o relógio real de quando o arquivo foi criado (`date -u +%Y%m%d%H%M%S`). Não copiar o timestamp do PR vizinho.

O `baseline.sql` continua sendo um arquivo só; faixa de NNNN **não** evita o conflito dele. Só o rebase do apêndice evita.

---

## 4. Como conferir de novo (não envelhece)

```bash
# runs de um SHA (PR head ou merge)
gh api "repos/felpzGondim/DeskcommCRM/actions/runs?head_sha=<sha>&per_page=20" \
  --jq '.workflow_runs[] | {name,event,conclusion,created_at,run_started_at,updated_at,id,html_url}'

# jobs (fila = started-created; execução = completed-started)
gh api "repos/felpzGondim/DeskcommCRM/actions/runs/<id>/jobs?per_page=100" \
  --jq '.jobs[] | {name,conclusion,created_at,started_at,completed_at}'

# tag felpz.9
# https://github.com/felpzGondim/DeskcommCRM/actions/runs/40684251289
```

A linha da felpz.10 entra neste documento depois do `publish-image` da tag, sem mudar a conclusão: o gargalo da tag é o app amd64 + a fila da duplicata com a `main`.
