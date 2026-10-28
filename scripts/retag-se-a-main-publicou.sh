#!/usr/bin/env bash
# Decide se o publish-image da tag pode RETAGGEAR o manifesto que a main já
# publicou neste SHA, em vez de construir de novo.
#
# Stdout: uma linha, `sim` ou `nao`. Diagnóstico em stderr. Exit 0 nos dois
# desfechos (nao é fallback, não é erro). Exit 1 só com uso inválido.
#
# Reusa só quando as QUATRO imagens têm o índice `sha-<SHA>` no GHCR com
# linux/amd64 E linux/arm64. Uma perna faltando → nao (tudo ou nada).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../hostgator-setup-kit/_manifestos.sh
source "${ROOT}/hostgator-setup-kit/_manifestos.sh"

REGISTRY="${REGISTRY:-ghcr.io}"
DONO="$(printf '%s' "${DONO:-}" | tr '[:upper:]' '[:lower:]')"
SHA="$(printf '%s' "${SHA:-}" | tr '[:upper:]' '[:lower:]')"
TIMEOUT_S="${TIMEOUT_S:-1320}"
POLL_S="${POLL_S:-20}"
IMAGENS="${IMAGENS:-deskcommcrm deskcomm-worker deskcomm-scheduler deskcomm-voice-agent}"

if [ -z "$DONO" ] || [ -z "$SHA" ]; then
  printf 'DONO e SHA são obrigatórios\n' >&2
  printf 'nao\n'
  exit 1
fi

if ! grep -Eq '^[0-9a-f]{40}$' <<<"$SHA"; then
  printf 'SHA inválido (esperado 40 hex): %s\n' "$SHA" >&2
  printf 'nao\n'
  exit 1
fi

if ! grep -Eq '^[0-9]+$' <<<"$TIMEOUT_S" || ! grep -Eq '^[0-9]+$' <<<"$POLL_S"; then
  printf 'TIMEOUT_S e POLL_S têm de ser inteiros\n' >&2
  printf 'nao\n'
  exit 1
fi

ref_sha() {
  printf '%s/%s/%s:sha-%s\n' "$REGISTRY" "$DONO" "$1" "$SHA"
}

conjunto_completo() {
  local img
  for img in $IMAGENS; do
    manifesto_tem_plataforma "$(ref_sha "$img")" linux/amd64 || return 1
    manifesto_tem_plataforma "$(ref_sha "$img")" linux/arm64 || return 1
  done
  return 0
}

inicio="$(date +%s)"
while true; do
  if conjunto_completo; then
    printf 'sim\n'
    exit 0
  fi
  agora="$(date +%s)"
  elapsed=$((agora - inicio))
  if [ "$elapsed" -ge "$TIMEOUT_S" ]; then
    printf 'timeout %ss — manifesto sha-%s incompleto; cai no build\n' "$TIMEOUT_S" "$SHA" >&2
    printf 'nao\n'
    exit 0
  fi
  sleep "$POLL_S"
done
