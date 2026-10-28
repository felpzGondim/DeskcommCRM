#!/usr/bin/env bash
# O script de retag só diz `sim` quando as quatro imagens têm o índice SHA
# com as duas arquiteturas; qualquer buraco (ou uso inválido) cai em `nao`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/retag-se-a-main-publicou.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

SHA40='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
DONO='felpzgondim'

both='{"schemaVersion":2,"manifests":[{"platform":{"os":"linux","architecture":"amd64"}},{"platform":{"os":"linux","architecture":"arm64"}}]}'

instalar_docker() {
  cat > "$TMP/bin/docker" <<'SH'
#!/usr/bin/env bash
ref="${*: -1}"
contador="${MOCK_CONTADOR:-}"
if [ -n "$contador" ]; then
  n=$(( $(cat "$contador" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$contador"
  # A primeira tentativa do laço falha no primeiro inspect; a seguinte passa.
  if [ "$n" -eq 1 ]; then
    exit 1
  fi
fi
if [ "${MOCK_FAIL:-0}" = 1 ]; then
  exit 1
fi
if [ -n "${MOCK_SEM_ARM:-}" ] && [ "${4:-}" != --raw ]; then
  case "$ref" in
    *"${MOCK_SEM_ARM}:"*) printf 'linux/amd64\n'; exit 0 ;;
  esac
fi
if [ "${4:-}" = --raw ]; then
  printf '%s' "${MOCK_RAW:-}"
else
  printf '%s' "${MOCK_FORMAT:-}"
fi
SH
  chmod +x "$TMP/bin/docker"
}
instalar_docker
export PATH="$TMP/bin:$PATH"

rodar() {
  REGISTRY=ghcr.io DONO="$DONO" SHA="$SHA40" TIMEOUT_S="${TIMEOUT_S:-0}" POLL_S="${POLL_S:-1}" \
    bash "$SCRIPT" >"$TMP/out" 2>"$TMP/err" && echo 0 >"$TMP/rc" || echo $? >"$TMP/rc"
}

expect() {
  local label="$1" rc_esp="$2" saida_esp="$3"
  local rc saida
  rc="$(<"$TMP/rc")"
  saida="$(tr -d '\n' <"$TMP/out")"
  if [ "$rc" != "$rc_esp" ] || [ "$saida" != "$saida_esp" ]; then
    printf '✗ %s: rc=%s saida=%q (esperado rc=%s saida=%q)\nstderr: %s\n' \
      "$label" "$rc" "$saida" "$rc_esp" "$saida_esp" "$(<"$TMP/err")"
    exit 1
  fi
  printf '✓ %s\n' "$label"
}

REGISTRY=ghcr.io DONO="$DONO" SHA= TIMEOUT_S=0 \
  bash "$SCRIPT" >"$TMP/out" 2>"$TMP/err" && echo 0 >"$TMP/rc" || echo $? >"$TMP/rc"
expect 'SHA ausente sai 1 com nao' 1 nao

REGISTRY=ghcr.io DONO="$DONO" SHA=abc TIMEOUT_S=0 \
  bash "$SCRIPT" >"$TMP/out" 2>"$TMP/err" && echo 0 >"$TMP/rc" || echo $? >"$TMP/rc"
expect 'SHA curto sai 1 com nao' 1 nao

export MOCK_RAW="$both" MOCK_FORMAT=$'linux/amd64\nlinux/arm64'
TIMEOUT_S=0 rodar
expect 'índice completo das quatro → sim' 0 sim

export MOCK_FAIL=1
TIMEOUT_S=0 rodar
expect 'registro inacessível → nao (fallback, exit 0)' 0 nao
unset MOCK_FAIL

export MOCK_SEM_ARM=deskcomm-worker
TIMEOUT_S=0 rodar
expect 'uma imagem sem arm64 → nao (tudo ou nada)' 0 nao
unset MOCK_SEM_ARM

export MOCK_CONTADOR="$TMP/n"
: > "$TMP/n"
TIMEOUT_S=5 POLL_S=1 rodar
expect 'segunda tentativa encontra o índice → sim' 0 sim
unset MOCK_CONTADOR
