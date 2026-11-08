#!/usr/bin/env bash
# M1 + M2 descartáveis nesta VM. Não toca produção. Segredos só em $WORKDIR/secrets.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export DISPOSABLE_DELEGACAO_WORKDIR="${DISPOSABLE_DELEGACAO_WORKDIR:-/tmp/disposable-delegacao}"
WORKDIR="$DISPOSABLE_DELEGACAO_WORKDIR"
HERE="$(cd "$(dirname "$0")" && pwd)"
EVID="$ROOT/docs/evidencias/delegacao-m1-m2-vm-2026-11-08.md"
RESULTS_DIR="$WORKDIR/results"
mkdir -p "$WORKDIR/secrets" "$RESULTS_DIR"
chmod 700 "$WORKDIR" "$WORKDIR/secrets" "$RESULTS_DIR"

GOTRUE_TAG=v2.196.0
GOTRUE_SHA=0204331ca41a5b49f076b6fa3dc6c0d20b996590
AUTH_SRC="$WORKDIR/auth"
GOTRUE_BIN="$WORKDIR/gotrue"
M1_PORT="${M1_PORT:-9999}"
PROXY_PORT="${PROXY_PORT:-9888}"
SITE_URL="http://127.0.0.1:3000"
REDIRECT_URI="http://127.0.0.1:3000/callback"
ISSUER="http://127.0.0.1:${PROXY_PORT}/auth/v1"
AUTH_URL="http://127.0.0.1:${M1_PORT}"
PROXY_URL="http://127.0.0.1:${PROXY_PORT}"

cleanup() {
  bash "$HERE/cleanup.sh" || true
}
trap cleanup EXIT INT TERM

echo "==> SHA do checkout $(git -C "$ROOT" rev-parse --short HEAD) $(git -C "$ROOT" rev-parse HEAD)"
echo "==> docker: $(command -v docker >/dev/null && echo present || echo absent)"
echo "==> postgres: $(psql --version 2>/dev/null || echo missing)"

if ! command -v psql >/dev/null; then
  echo "BLOQUEIO: psql ausente após apt. Não vou para produção." >&2
  exit 2
fi

# --- secrets (nunca ecoados) ---
umask 077
if [ ! -f "$WORKDIR/secrets/jwt" ]; then
  openssl rand -hex 32 > "$WORKDIR/secrets/jwt"
fi
if [ ! -f "$WORKDIR/secrets/auth_admin_pw" ]; then
  openssl rand -hex 24 > "$WORKDIR/secrets/auth_admin_pw"
fi
if [ ! -f "$WORKDIR/secrets/user_pw" ]; then
  openssl rand -hex 18 > "$WORKDIR/secrets/user_pw"
fi
JWT_SECRET="$(cat "$WORKDIR/secrets/jwt")"
AUTH_ADMIN_PW="$(cat "$WORKDIR/secrets/auth_admin_pw")"
USER_PW="$(cat "$WORKDIR/secrets/user_pw")"
USER_EMAIL="m1-synthetic-$(openssl rand -hex 4)@invariant.test"
printf '%s\n' "$USER_EMAIL" > "$WORKDIR/secrets/user_email"

# --- roles / DBs ---
psql -d postgres -v ON_ERROR_STOP=1 -q <<SQL
select pg_terminate_backend(pid) from pg_stat_activity
  where datname in ('m1_auth','m2_synth','m2_crm','inv_baseline') and pid <> pg_backend_pid();
drop database if exists m1_auth with (force);
drop database if exists m2_synth with (force);
drop database if exists m2_crm with (force);
drop database if exists inv_baseline with (force);
do \$\$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login createrole bypassrls password '${AUTH_ADMIN_PW}';
  else
    execute format('alter role supabase_auth_admin with login createrole bypassrls password %L', '${AUTH_ADMIN_PW}');
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
\$\$;
create database m1_auth owner supabase_auth_admin;
create database m2_synth owner ubuntu;
SQL

# --- clone / build GoTrue ---
if [ ! -d "$AUTH_SRC/.git" ]; then
  git clone --depth 1 --branch "$GOTRUE_TAG" https://github.com/supabase/auth.git "$AUTH_SRC"
fi
MEASURED_SHA="$(git -C "$AUTH_SRC" rev-parse HEAD)"
if [ "$MEASURED_SHA" != "$GOTRUE_SHA" ]; then
  echo "BLOQUEIO: SHA GoTrue $MEASURED_SHA ≠ pin $GOTRUE_SHA" >&2
  exit 2
fi

if [ ! -x "$GOTRUE_BIN" ]; then
  echo "==> compilando GoTrue $GOTRUE_TAG ($GOTRUE_SHA)"
  export GOTOOLCHAIN=auto
  export GOPATH="$WORKDIR/gopath"
  export GOCACHE="$WORKDIR/gocache"
  export GOMODCACHE="$WORKDIR/gomodcache"
  export CGO_ENABLED=0
  mkdir -p "$GOPATH" "$GOCACHE" "$GOMODCACHE"
  ( cd "$AUTH_SRC" && go build -trimpath -ldflags='-s -w' -o "$GOTRUE_BIN" . )
fi
chmod 700 "$GOTRUE_BIN"
GOTRUE_DIGEST="$(sha256sum "$GOTRUE_BIN" | awk '{print $1}')"
GO_VER="$(go version || true)"
if [ -x "$GOTRUE_BIN" ]; then
  # toolchain usada no binário
  GO_VER="$(GOTOOLCHAIN=auto go version 2>/dev/null || echo "$GO_VER")"
fi
echo "==> gotrue sha256=$GOTRUE_DIGEST go=$GO_VER"

# --- hook SQL no banco do Auth (depois do migrate, reaplicamos) ---
export GOTRUE_JWT_SECRET="$JWT_SECRET"
export GOTRUE_JWT_EXP=3600
export GOTRUE_JWT_AUD=authenticated
export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
export GOTRUE_JWT_ADMIN_ROLES="supabase_admin,service_role"
export GOTRUE_JWT_ISSUER="$ISSUER"
export GOTRUE_DB_DRIVER=postgres
export DB_NAMESPACE=auth
AUTH_ADMIN_PW_ENC="$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$AUTH_ADMIN_PW")"
export DATABASE_URL="postgres://supabase_auth_admin:${AUTH_ADMIN_PW_ENC}@127.0.0.1:5432/m1_auth?sslmode=disable"
export API_EXTERNAL_URL="$ISSUER"
export GOTRUE_API_HOST=127.0.0.1
export PORT="$M1_PORT"
export GOTRUE_MAILER_AUTOCONFIRM=true
export GOTRUE_DISABLE_SIGNUP=false
export GOTRUE_SITE_URL="$SITE_URL"
export GOTRUE_URI_ALLOW_LIST="${SITE_URL},${AUTH_URL},${PROXY_URL},${ISSUER},${REDIRECT_URI}"
export GOTRUE_EXTERNAL_EMAIL_ENABLED=true
export GOTRUE_EXTERNAL_PHONE_ENABLED=false
export GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false
export GOTRUE_EXTERNAL_LINKEDIN_ENABLED=false
export GOTRUE_EXTERNAL_WORKOS_ENABLED=false
export GOTRUE_EXTERNAL_SAML_ENABLED=false
export GOTRUE_EXTERNAL_WEB3_SOLANA_ENABLED=false
export GOTRUE_EXTERNAL_WEB3_ETHEREUM_ENABLED=false
export GOTRUE_SECURITY_CAPTCHA_ENABLED=false
export GOTRUE_LOG_LEVEL=info
export GOTRUE_OAUTH_SERVER_ENABLED=true
export GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH=/oauth/consent
export GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION=false
export GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true
export GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI="pg-functions://postgres/public/custom_access_token_hook"
export GOTRUE_RATE_LIMIT_HEADER=""
export GOTRUE_RATE_LIMIT_EMAIL_SENT=1000
export GOTRUE_RATE_LIMIT_TOKEN_REFRESH=1000
export GOTRUE_RATE_LIMIT_VERIFY=1000

psql -d m1_auth -v ON_ERROR_STOP=1 -q <<SQL
create schema if not exists auth authorization supabase_auth_admin;
grant all on schema auth to supabase_auth_admin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema public, extensions to supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth, public, extensions;
SQL

echo "==> gotrue migrate"
"$GOTRUE_BIN" migrate

# hook precisa existir ANTES do serve emitir tokens
psql -d m1_auth -v ON_ERROR_STOP=1 -q -f "$HERE/m1-hook.sql"

echo "==> gotrue serve :$M1_PORT"
"$GOTRUE_BIN" serve >"$WORKDIR/gotrue.log" 2>&1 &
echo $! > "$WORKDIR/gotrue.pid"
ready=0
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${M1_PORT}/health" >/dev/null 2>&1 \
    || curl -sf "http://127.0.0.1:${M1_PORT}/" >/dev/null 2>&1; then
    ready=1; break
  fi
  # health pode ser 404/200; qualquer TCP HTTP conta
  if curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${M1_PORT}/health" | grep -qE '^[0-9]{3}$'; then
    ready=1; break
  fi
  sleep 0.5
done
if [ "$ready" != 1 ]; then
  echo "BLOQUEIO: GoTrue não respondeu em :$M1_PORT" >&2
  tail -n 40 "$WORKDIR/gotrue.log" >&2 || true
  exit 2
fi
echo "    ✓ gotrue up"

# --- M1 ---
echo "==> M1 PKCE"
set +e
M1_AUTH_URL="$AUTH_URL" \
M1_PROXY_URL="$PROXY_URL" \
M1_ISSUER="$ISSUER" \
M1_SITE_URL="$SITE_URL" \
M1_REDIRECT_URI="$REDIRECT_URI" \
M1_JWT_SECRET="$JWT_SECRET" \
M1_USER_EMAIL="$USER_EMAIL" \
M1_USER_PASSWORD="$USER_PW" \
M1_RESULTS_PATH="$RESULTS_DIR/m1.json" \
M1_PSQL="$(command -v psql)" \
  node "$HERE/m1-oauth.mjs"
M1_EC=$?
set -e
echo "    M1 exit=$M1_EC"

# --- M2 synth ---
echo "==> M2 SQL sintético"
set +e
psql -d m2_synth -v ON_ERROR_STOP=1 -f "$HERE/m2-acl.sql" >"$RESULTS_DIR/m2-synth.txt" 2>&1
M2S_EC=$?
set -e
echo "    M2 synth exit=$M2S_EC"

# --- M2 baseline + invariantes delegacao ---
echo "==> M2 baseline CRM (pgvector local)"
set +e
psql -d postgres -v ON_ERROR_STOP=1 -q -c "create database m2_crm owner ubuntu;"
psql -d m2_crm -v ON_ERROR_STOP=1 -q -f "$HERE/prelude-crm.sql"
psql -d m2_crm -v ON_ERROR_STOP=1 -q -c "create database inv_baseline;" 2>/dev/null
# aplicar prelude+baseline no molde
psql -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
drop database if exists inv_baseline with (force);
create database inv_baseline owner ubuntu;
SQL
psql -d inv_baseline -v ON_ERROR_STOP=1 -q -f "$HERE/prelude-crm.sql"
psql -d inv_baseline -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/baseline.sql"
M2B_EC=$?
set -e
echo "    baseline apply exit=$M2B_EC"

M2I_EC=3
M2I_OUT="$RESULTS_DIR/m2-invariants.txt"
if [ "$M2B_EC" = 0 ]; then
  echo "==> invariantes delegacao-* via psql local"
  set +e
  (
    cd "$ROOT"
    export TEST_DB_PSQL
    TEST_DB_PSQL="$(command -v psql)"
    export TEST_DB_PSQL
    export TEST_DB_TEMPLATE=inv_baseline
    export TEST_DB_CONTAINER=local-psql
    export TEST_DB_NAME=postgres
    # o setupFile dropa o DB `postgres` do cluster — NÃO fazer isso no cluster default.
    # Usamos um database de trabalho `m2_crm` como TEST_DB_NAME.
    export TEST_DB_NAME=m2_crm
    pnpm exec vitest run --config vitest.db.config.ts \
      tests/invariants/delegacao-papel-publico-nao-isola.test.ts \
      tests/invariants/delegacao-visibilidade-corporativa-rls.test.ts \
      tests/invariants/delegacao-oauth-deriva-rls.test.ts
  ) >"$M2I_OUT" 2>&1
  M2I_EC=$?
  set -e
  echo "    invariantes exit=$M2I_EC"
else
  echo "    baseline não aplicou — invariantes CRM não rodaram (blocker registado)"
  echo "baseline_apply_failed" >"$M2I_OUT"
fi

# sanitizar log do gotrue (não copiar tokens)
python3 - <<'PY' >"$RESULTS_DIR/gotrue.log.sanitized" || true
import re, pathlib
p = pathlib.Path("/tmp/disposable-delegacao/gotrue.log")
if not p.exists():
    raise SystemExit
rx = re.compile(r'(access_token|refresh_token|id_token|client_secret|authorization|password|code)=([^&\s"]+)', re.I)
for line in p.read_text(errors="replace").splitlines()[-80:]:
    line = rx.sub(lambda m: m.group(1)+'=[redacted]', line)
    line = re.sub(r'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[jwt-redacted]', line)
    print(line)
PY

# --- evidência ---
python3 - "$EVID" "$RESULTS_DIR" "$GOTRUE_DIGEST" "$MEASURED_SHA" "$M1_EC" "$M2S_EC" "$M2B_EC" "$M2I_EC" "$(git -C "$ROOT" rev-parse HEAD)" <<'PY'
import json, pathlib, sys, datetime, re
evid, rdir, digest, gsha, m1, m2s, m2b, m2i, head = sys.argv[1:]
rdir = pathlib.Path(rdir)
m1p = rdir / "m1.json"
m1j = {}
if m1p.exists():
    m1j = json.loads(m1p.read_text())
synth = (rdir / "m2-synth.txt").read_text(errors="replace") if (rdir/"m2-synth.txt").exists() else ""
inv = (rdir / "m2-invariants.txt").read_text(errors="replace") if (rdir/"m2-invariants.txt").exists() else ""
# keep last 80 lines of invariants, strip possible secrets
inv_tail = "\n".join(inv.splitlines()[-120:])
inv_tail = re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[jwt]', inv_tail)
synth_sum = [ln for ln in synth.splitlines() if ln.startswith("PASS") or ln.startswith("FAIL") or "pass" in ln.lower() and "fail" in ln.lower() or ln.strip().startswith("NOTICE")]
# counts from synth
import re as _re
pass_s = fail_s = None
for ln in synth.splitlines():
    m = _re.search(r'^\s*(\d+)\s+\|\s+(\d+)\s+\|\s+(\d+)\s*$', ln.replace(' ',''))
# parse last SELECT of pass/fail/total
rows = [ln for ln in synth.splitlines() if "|" in ln]
# m2.results printed as table; last numeric row
m2_pass = m2_fail = None
for ln in reversed(synth.splitlines()):
    parts = [p.strip() for p in ln.split("|")]
    if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
        m2_pass, m2_fail = int(parts[0]), int(parts[1])
        break

cases = m1j.get("cases") or []
lines = []
lines.append("# Evidência M1/M2 — VM descartável 2026-11-08")
lines.append("")
lines.append("Não é produção. Não liga hook/grant no produto. Sem merge/tag/deploy.")
lines.append("")
lines.append(f"- **Quando:** {datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}")
lines.append(f"- **Checkout:** `{head}`")
lines.append(f"- **GoTrue git:** `{gsha}` (tag v2.196.0)")
lines.append(f"- **GoTrue binário sha256:** `{digest}`")
lines.append(f"- **Postgres:** 16.15 local (apt). **Docker:** ausente. **Imagem gotrue:** não puxada (compilado da tag).")
lines.append(f"- **M1 exit:** {m1} — pass={m1j.get('pass')} fail={m1j.get('fail')} skip={m1j.get('skip')}")
lines.append(f"- **M2 synth exit:** {m2s} — pass={m2_pass} fail={m2_fail}")
lines.append(f"- **M2 baseline apply exit:** {m2b}")
lines.append(f"- **M2 invariantes delegacao-* exit:** {m2i}")
lines.append("")
lines.append("## M1 casos (claims não-sensíveis)")
lines.append("")
for c in cases:
    tag = "PASS" if c.get("ok") else ("SKIP" if c.get("skip") else "FAIL")
    det = json.dumps(c.get("detail"), ensure_ascii=False)
    if len(det) > 400: det = det[:400]+"…"
    lines.append(f"- `{tag}` `{c.get('id')}` {det}")
lines.append("")
lines.append("Fixture IDs (não são tokens):")
lines.append(f"- user_id `{m1j.get('user_id')}`")
lines.append(f"- mapped_client_id `{m1j.get('mapped_client_id')}`")
lines.append(f"- control_client_id `{m1j.get('control_client_id')}`")
lines.append("")
lines.append("## M2 sintético (últimas linhas)")
lines.append("")
lines.append("```")
lines.append("\n".join(synth.splitlines()[-40:]))
lines.append("```")
lines.append("")
lines.append("## M2 invariantes CRM (cauda)")
lines.append("")
lines.append("```")
lines.append(inv_tail)
lines.append("```")
lines.append("")
lines.append("## Cleanup")
lines.append("Trap EXIT do `run.sh` chama `cleanup.sh`: mata GoTrue, dropa DBs `m1_auth`/`m2_*`/`inv_baseline`, `shred` em `$WORKDIR/secrets`.")
pathlib.Path(evid).parent.mkdir(parents=True, exist_ok=True)
pathlib.Path(evid).write_text("\n".join(lines)+"\n")
print("wrote", evid)
PY

if [ -f "$RESULTS_DIR/m1.json" ]; then
  cp "$RESULTS_DIR/m1.json" "$ROOT/docs/evidencias/delegacao-m1-results.json"
  chmod 644 "$ROOT/docs/evidencias/delegacao-m1-results.json"
fi
echo "==> evidência em $EVID"
# não vazar secrets no stdout
unset JWT_SECRET AUTH_ADMIN_PW USER_PW DATABASE_URL GOTRUE_JWT_SECRET
exit 0
