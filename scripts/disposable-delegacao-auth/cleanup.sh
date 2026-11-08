#!/usr/bin/env bash
# Derruba o Auth/Postgres sintético desta VM. Idempotente.
set -u
WORKDIR="${DISPOSABLE_DELEGACAO_WORKDIR:-/tmp/disposable-delegacao}"
echo "==> cleanup disposable-delegacao ($WORKDIR)"

if [ -f "$WORKDIR/gotrue.pid" ]; then
  pid="$(cat "$WORKDIR/gotrue.pid" 2>/dev/null || true)"
  if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$WORKDIR/gotrue.pid"
fi
if [ -f "$WORKDIR/proxy.pid" ]; then
  pid="$(cat "$WORKDIR/proxy.pid" 2>/dev/null || true)"
  if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$WORKDIR/proxy.pid"
fi
pkill -f '/tmp/disposable-delegacao/gotrue serve' 2>/dev/null || true

if command -v psql >/dev/null 2>&1; then
  psql -d postgres -v ON_ERROR_STOP=0 -q <<'SQL' || true
select pg_terminate_backend(pid) from pg_stat_activity
  where datname in ('m1_auth','m2_crm','m2_synth','inv_baseline','inv_baseline_uma_aplicacao')
    and pid <> pg_backend_pid();
drop database if exists m1_auth with (force);
drop database if exists m2_crm with (force);
drop database if exists m2_synth with (force);
drop database if exists inv_baseline with (force);
drop database if exists inv_baseline_uma_aplicacao with (force);
drop database if exists postgres_m2 with (force);
SQL
  psql -d postgres -v ON_ERROR_STOP=0 -q <<'SQL' || true
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'drop owned by authenticator cascade';
    execute 'drop role authenticator';
  end if;
  if exists (select 1 from pg_roles where rolname = 'oauth_delegado') then
    execute 'drop owned by oauth_delegado cascade';
    execute 'drop role oauth_delegado';
  end if;
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'drop owned by supabase_auth_admin cascade';
    execute 'drop role supabase_auth_admin';
  end if;
exception when others then
  raise notice 'cleanup roles: %', sqlerrm;
end
$$;
SQL
fi

if [ -d "$WORKDIR/secrets" ]; then
  find "$WORKDIR/secrets" -type f -exec shred -u {} \; 2>/dev/null \
    || find "$WORKDIR/secrets" -type f -exec rm -f {} \;
  rm -rf "$WORKDIR/secrets"
fi

echo "    ✓ processos Auth parados; DBs sintéticos dropados; secrets apagados"
echo "    (pacotes apt/postgres e o binário compilado ficam até rm -rf $WORKDIR)"
