#!/usr/bin/env bash
# Shared configuration + helpers for the KovaView local dev stack.
#
# The app (Next.js) and pipeline (Python) both talk to Supabase's PostgREST
# HTTP API. There is no Docker in the Cloud Agent VM, so instead of the
# Supabase CLI we run a Supabase-compatible stack natively:
#
#   PostgreSQL  (:5433)   — database, owned by the `ubuntu` user
#   PostgREST   (:3001)   — REST layer, JWT roles anon / service_role
#   nginx       (:54321)  — gateway mapping /rest/v1/* -> PostgREST root
#
# supabase-js / supabase-py point NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL at
# the nginx gateway, so no application code changes are required.

set -o pipefail

export KV="${KV:-$HOME/.kovaview}"
export PGDATA="$KV/pgdata"
export PGPORT="${KV_PGPORT:-5433}"
export PGREST_PORT="${KV_PGREST_PORT:-3001}"
export GATEWAY_PORT="${KV_GATEWAY_PORT:-54321}"
export DBNAME="kovaview"
export DBUSER="ubuntu"

# Newest installed PostgreSQL bin dir (e.g. /usr/lib/postgresql/16/bin)
if [ -z "${PGBIN:-}" ]; then
  PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
fi
export PGBIN

mkdir -p "$KV/logs"

psql_su() {
  local db="${1:-postgres}"; shift || true
  "$PGBIN/psql" -p "$PGPORT" -h 127.0.0.1 -U "$DBUSER" -d "$db" -v ON_ERROR_STOP=1 "$@"
}

pg_running() { "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; }

ensure_postgres() {
  if pg_running; then return 0; fi
  "$PGBIN/pg_ctl" -D "$PGDATA" -l "$KV/logs/postgres.log" \
    -o "-p $PGPORT -k /tmp -c listen_addresses=127.0.0.1" -w start
  # wait until it accepts connections
  for _ in $(seq 1 30); do
    if "$PGBIN/pg_isready" -p "$PGPORT" -h 127.0.0.1 >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "postgres did not become ready" >&2; return 1
}

ensure_postgrest() {
  if ! pgrep -f "postgrest $KV/postgrest.conf" >/dev/null 2>&1; then
    nohup postgrest "$KV/postgrest.conf" >"$KV/logs/postgrest.log" 2>&1 &
  fi
  for _ in $(seq 1 30); do
    if curl -fs -o /dev/null "http://127.0.0.1:$PGREST_PORT/" 2>/dev/null; then return 0; fi
    sleep 1
  done
  echo "postgrest did not become ready" >&2; return 1
}

ensure_nginx() {
  if [ -f "$KV/nginx/nginx.pid" ] && kill -0 "$(cat "$KV/nginx/nginx.pid" 2>/dev/null)" 2>/dev/null; then
    return 0
  fi
  nginx -c "$KV/nginx.conf"
  for _ in $(seq 1 15); do
    if curl -fs -o /dev/null "http://127.0.0.1:$GATEWAY_PORT/health" 2>/dev/null; then return 0; fi
    sleep 1
  done
  echo "nginx gateway did not become ready" >&2; return 1
}
