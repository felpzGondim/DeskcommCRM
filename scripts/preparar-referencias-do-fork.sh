#!/usr/bin/env bash
# Referências de comparação do CI; nunca publica tags nem altera a VPS.
set -euo pipefail

[[ "${GITHUB_REPOSITORY:-}" == "felpzGondim/DeskcommCRM" ]] || exit 0
: "${GITHUB_ENV:?este script roda no GitHub Actions}"

upstream="https://github.com/melgarafael/DeskcommCRM.git"
profundidade=()
if [[ "$(git rev-parse --is-shallow-repository)" == true ]]; then
  profundidade=(--depth=1)
fi
buscar_tag() {
  git fetch --no-tags "${profundidade[@]}" "$upstream" "refs/tags/$1:refs/tags/$1"
}

# O fork não recebe as tags do original quando apenas a main é sincronizada.
# O teste de isolamento também mede o kit anterior à correção de v1.63.0.
buscar_tag v1.63.0

release="$(gh release view --repo "$GITHUB_REPOSITORY" --json tagName -q .tagName 2>/dev/null || true)"
if [[ -z "$release" ]]; then
  echo "Fork ainda sem release acessível: comparando também com a release publicada do original."
  release="$(gh release view --repo melgarafael/DeskcommCRM --json tagName -q .tagName)"
  [[ "$release" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]] || {
    echo "Release original inválida; a conferência não será pulada." >&2
    exit 1
  }
  buscar_tag "$release"
fi
[[ "$release" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]] || exit 1
printf 'CONFERENCIA_KIT_RELEASE=%s\n' "$release" >> "$GITHUB_ENV"
