#!/usr/bin/env bash
# Idempotent setup for the KovaView dev environment.
# Safe to run repeatedly; preserves existing database contents.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_DIR"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/common.sh"

POSTGREST_VERSION="v16.1"

echo "== 1/9 System packages =="
NEED_APT=0
for pkg in postgresql postgresql-contrib nginx jq python3-venv; do
  dpkg -s "$pkg" >/dev/null 2>&1 || NEED_APT=1
done
if [ "$NEED_APT" = "1" ]; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    postgresql postgresql-contrib nginx jq python3-venv python3-full
fi
# refresh PGBIN now that postgres is installed
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"; export PGBIN

echo "== 2/9 PostgREST binary =="
if ! command -v postgrest >/dev/null 2>&1; then
  case "$(uname -m)" in
    aarch64|arm64) PGRST_ARCH="aarch64" ;;
    *)             PGRST_ARCH="x86-64" ;;
  esac
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/postgrest.tar.xz" \
    "https://github.com/PostgREST/postgrest/releases/download/${POSTGREST_VERSION}/postgrest-${POSTGREST_VERSION}-linux-static-${PGRST_ARCH}.tar.xz"
  tar -xf "$tmp/postgrest.tar.xz" -C "$tmp"
  sudo mv "$tmp/postgrest" /usr/local/bin/postgrest
  sudo chmod +x /usr/local/bin/postgrest
  rm -rf "$tmp"
fi

echo "== 3/9 PostgreSQL cluster =="
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA"
  "$PGBIN/initdb" -D "$PGDATA" -U "$DBUSER" --auth=trust >/dev/null
fi
ensure_postgres

echo "== 4/9 Database, roles, grants =="
if ! psql_su postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DBNAME'" | grep -q 1; then
  psql_su postgres -c "CREATE DATABASE $DBNAME;"
fi
psql_su postgres <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT; END IF;
END$$;
GRANT anon, authenticated, service_role TO authenticator;
SQL

echo "== 5/9 Schema migrations =="
if psql_su "$DBNAME" -tAc "SELECT to_regclass('public.universe_members')" | grep -q universe_members; then
  echo "   schema already present, skipping full replay"
  if ! psql_su "$DBNAME" -tAc "SELECT to_regclass('public.paper_book')" | grep -q paper_book; then
    echo "   applying supabase/migrations/007_paper_loop.sql"
    psql_su "$DBNAME" -f supabase/migrations/007_paper_loop.sql >/dev/null
    psql_su "$DBNAME" -c "NOTIFY pgrst, 'reload schema';" >/dev/null || true
  fi
  if ! psql_su "$DBNAME" -tAc "SELECT to_regclass('public.skew_names')" | grep -q skew_names; then
    echo "   applying supabase/migrations/008_skew_map.sql"
    psql_su "$DBNAME" -f supabase/migrations/008_skew_map.sql >/dev/null
    psql_su "$DBNAME" -c "NOTIFY pgrst, 'reload schema';" >/dev/null || true
  fi
  if ! psql_su "$DBNAME" -tAc "SELECT to_regclass('public.orb_watch')" | grep -q orb_watch; then
    echo "   applying supabase/migrations/009_orb.sql"
    psql_su "$DBNAME" -f supabase/migrations/009_orb.sql >/dev/null
    psql_su "$DBNAME" -c "NOTIFY pgrst, 'reload schema';" >/dev/null || true
  fi
  if ! psql_su "$DBNAME" -tAc "SELECT to_regclass('public.analysis_names')" | grep -q analysis_names; then
    echo "   applying supabase/migrations/010_analysis.sql"
    psql_su "$DBNAME" -f supabase/migrations/010_analysis.sql >/dev/null
    psql_su "$DBNAME" -c "NOTIFY pgrst, 'reload schema';" >/dev/null || true
  fi
  if ! psql_su "$DBNAME" -tAc "SELECT to_regclass('public.quantropy_names')" | grep -q quantropy_names; then
    echo "   applying supabase/migrations/011_quantropy.sql"
    psql_su "$DBNAME" -f supabase/migrations/011_quantropy.sql >/dev/null
    psql_su "$DBNAME" -c "NOTIFY pgrst, 'reload schema';" >/dev/null || true
  fi
  if ! psql_su "$DBNAME" -tAc "SELECT to_regclass('public.bias_names')" | grep -q bias_names; then
    echo "   applying supabase/migrations/012_daily_bias.sql"
    psql_su "$DBNAME" -f supabase/migrations/012_daily_bias.sql >/dev/null
    psql_su "$DBNAME" -c "NOTIFY pgrst, 'reload schema';" >/dev/null || true
  fi
  if ! psql_su "$DBNAME" -tAc "SELECT to_regclass('public.perp_names')" | grep -q perp_names; then
    echo "   applying supabase/migrations/013_qmie_perps.sql"
    psql_su "$DBNAME" -f supabase/migrations/013_qmie_perps.sql >/dev/null
    psql_su "$DBNAME" -c "NOTIFY pgrst, 'reload schema';" >/dev/null || true
  fi
  if ! psql_su "$DBNAME" -tAc "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='perp_names' AND column_name='macd'" | grep -q 1; then
    echo "   applying supabase/migrations/014_perps_macd.sql"
    psql_su "$DBNAME" -f supabase/migrations/014_perps_macd.sql >/dev/null
    psql_su "$DBNAME" -c "NOTIFY pgrst, 'reload schema';" >/dev/null || true
  fi
  if ! psql_su "$DBNAME" -tAc "SELECT to_regclass('public.sector_rotation_groups')" | grep -q sector_rotation_groups; then
    echo "   applying supabase/migrations/015_sector_rotation.sql"
    psql_su "$DBNAME" -f supabase/migrations/015_sector_rotation.sql >/dev/null
    psql_su "$DBNAME" -c "NOTIFY pgrst, 'reload schema';" >/dev/null || true
  fi
  if ! psql_su "$DBNAME" -tAc "SELECT to_regclass('public.sector_rotation_canaries')" | grep -q sector_rotation_canaries; then
    echo "   applying supabase/migrations/016_macro_canaries.sql"
    psql_su "$DBNAME" -f supabase/migrations/016_macro_canaries.sql >/dev/null
    psql_su "$DBNAME" -c "NOTIFY pgrst, 'reload schema';" >/dev/null || true
  fi
  if ! psql_su "$DBNAME" -tAc "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sector_rotation_groups' AND column_name='parent_sector'" | grep -q 1; then
    echo "   applying supabase/migrations/017_subsector_parent.sql"
    psql_su "$DBNAME" -f supabase/migrations/017_subsector_parent.sql >/dev/null
    psql_su "$DBNAME" -c "NOTIFY pgrst, 'reload schema';" >/dev/null || true
  fi
  if ! psql_su "$DBNAME" -tAc "SELECT to_regclass('public.sector_rotation_carver')" | grep -q sector_rotation_carver; then
    echo "   applying supabase/migrations/018_rotate_carver.sql"
    psql_su "$DBNAME" -f supabase/migrations/018_rotate_carver.sql >/dev/null
    psql_su "$DBNAME" -c "NOTIFY pgrst, 'reload schema';" >/dev/null || true
  fi
  if ! psql_su "$DBNAME" -tAc "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='perp_names' AND column_name='tema_shares'" | grep -q 1; then
    echo "   applying supabase/migrations/019_cash_book.sql"
    psql_su "$DBNAME" -f supabase/migrations/019_cash_book.sql >/dev/null
    psql_su "$DBNAME" -c "NOTIFY pgrst, 'reload schema';" >/dev/null || true
  fi
  if ! psql_su "$DBNAME" -tAc "SELECT to_regclass('public.ingest_runs')" | grep -q ingest_runs; then
    echo "   applying supabase/migrations/020_ingest_runs.sql"
    psql_su "$DBNAME" -f supabase/migrations/020_ingest_runs.sql >/dev/null
    psql_su "$DBNAME" -c "NOTIFY pgrst, 'reload schema';" >/dev/null || true
  fi
else
  for f in supabase/migrations/*.sql; do
    echo "   applying $f"
    psql_su "$DBNAME" -f "$f" >/dev/null
  done
fi
psql_su "$DBNAME" <<'SQL'
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
SQL

echo "== 6/9 JWT secret, tokens, service configs, .env files =="
[ -f "$KV/jwt_secret" ] || openssl rand -hex 32 > "$KV/jwt_secret"
SECRET="$(cat "$KV/jwt_secret")"
python3 - "$SECRET" > "$KV/tokens.env" <<'PY'
import sys, hmac, hashlib, base64, json
secret = sys.argv[1].encode()
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b'=')
def jwt(role):
    h = b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(',',':')).encode())
    p = b64(json.dumps({"role":role,"iss":"kovaview-local","iat":1700000000,"exp":2000000000},separators=(',',':')).encode())
    s = b64(hmac.new(secret, h+b'.'+p, hashlib.sha256).digest())
    return (h+b'.'+p+b'.'+s).decode()
print("ANON_KEY=" + jwt("anon"))
print("SERVICE_KEY=" + jwt("service_role"))
PY
# shellcheck source=/dev/null
source "$KV/tokens.env"

cat > "$KV/postgrest.conf" <<EOF
db-uri = "postgres://authenticator@127.0.0.1:$PGPORT/$DBNAME"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = $PGREST_PORT
db-pool = 10
EOF

mkdir -p "$KV/nginx/tmp/client" "$KV/nginx/tmp/proxy" "$KV/nginx/tmp/fastcgi" "$KV/nginx/tmp/uwsgi" "$KV/nginx/tmp/scgi"
cat > "$KV/nginx.conf" <<EOF
worker_processes 1;
pid $KV/nginx/nginx.pid;
error_log $KV/logs/nginx-error.log warn;
events { worker_connections 256; }
http {
  access_log $KV/logs/nginx-access.log;
  client_body_temp_path $KV/nginx/tmp/client;
  proxy_temp_path $KV/nginx/tmp/proxy;
  fastcgi_temp_path $KV/nginx/tmp/fastcgi;
  uwsgi_temp_path $KV/nginx/tmp/uwsgi;
  scgi_temp_path $KV/nginx/tmp/scgi;
  server {
    listen 127.0.0.1:$GATEWAY_PORT;
    location /rest/v1/ { proxy_pass http://127.0.0.1:$PGREST_PORT/; proxy_set_header Host \$host; }
    location = /health { return 200 'ok'; add_header Content-Type text/plain; }
  }
}
EOF

# Write .env files only if absent, so re-runs don't clobber local edits.
if [ ! -f "$REPO_DIR/.env.local" ]; then
  cat > "$REPO_DIR/.env.local" <<EOF
# Local dev — Supabase-compatible stack (Postgres + PostgREST + nginx gateway)
SUPABASE_URL=http://127.0.0.1:$GATEWAY_PORT
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$GATEWAY_PORT
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_KEY=$SERVICE_KEY
EOF
fi
if [ ! -f "$REPO_DIR/.env" ]; then
  cat > "$REPO_DIR/.env" <<EOF
SUPABASE_URL=http://127.0.0.1:$GATEWAY_PORT
SUPABASE_SERVICE_KEY=$SERVICE_KEY
EOF
fi

echo "== 7/9 Python virtualenv =="
[ -d "$REPO_DIR/.venv" ] || python3 -m venv "$REPO_DIR/.venv"
"$REPO_DIR/.venv/bin/pip" install --quiet --upgrade pip
"$REPO_DIR/.venv/bin/pip" install --quiet -r pipeline/requirements.txt

echo "== 8/9 Node dependencies =="
if [ -f package-lock.json ]; then npm ci; else npm install; fi

echo "== 9/9 Seed demo data + compute signals (first run only) =="
ensure_postgrest
ensure_nginx
UNIVERSE_COUNT="$(psql_su "$DBNAME" -tAc 'SELECT count(*) FROM universe_members' | tr -d '[:space:]')"
if [ "${UNIVERSE_COUNT:-0}" = "0" ]; then
  "$REPO_DIR/.venv/bin/python" -m scripts.seed_demo
fi
# Best-effort cash EOD (Yahoo → Stooq). Replaces seed_demo tape when the
# public REST path is reachable. Safe to skip — compute still has synthetic.
REAL_PX="$(psql_su "$DBNAME" -tAc "SELECT count(*) FROM prices_daily WHERE source IN ('yahoo','stooq','yfinance','lse')" | tr -d '[:space:]')"
if [ "${REAL_PX:-0}" = "0" ]; then
  "$REPO_DIR/.venv/bin/python" -m pipeline.ingest.cash_eod || true
fi
RADAR_COUNT="$(psql_su "$DBNAME" -tAc 'SELECT count(*) FROM trend_radar' | tr -d '[:space:]')"
if [ "${RADAR_COUNT:-0}" = "0" ]; then
  "$REPO_DIR/.venv/bin/python" -m pipeline.compute.trend_radar
  "$REPO_DIR/.venv/bin/python" -m pipeline.compute.aggregates
  "$REPO_DIR/.venv/bin/python" -m pipeline.compute.factor_scores
fi
# Health-sector catalysts from the free ClinicalTrials.gov API (best-effort;
# the client tolerates network failures and simply yields no rows).
SIGNAL_COUNT="$(psql_su "$DBNAME" -tAc 'SELECT count(*) FROM pharma_signals' | tr -d '[:space:]')"
if [ "${SIGNAL_COUNT:-0}" = "0" ]; then
  "$REPO_DIR/.venv/bin/python" -m pipeline.ingest.pharma_trials || true
  "$REPO_DIR/.venv/bin/python" -m pipeline.compute.pharma_signals || true
fi
# Paper breakout book — run once when empty so LOOP terminal has a first book.
BOOK_COUNT="$(psql_su "$DBNAME" -tAc 'SELECT count(*) FROM paper_book' | tr -d '[:space:]')"
if [ "${BOOK_COUNT:-0}" = "0" ]; then
  "$REPO_DIR/.venv/bin/python" -m pipeline.compute.portfolio_loop || true
fi
# Listed IV skew map — first-run snapshot from yfinance option chains.
SKEW_COUNT="$(psql_su "$DBNAME" -tAc 'SELECT count(*) FROM skew_names' | tr -d '[:space:]')"
if [ "${SKEW_COUNT:-0}" = "0" ]; then
  "$REPO_DIR/.venv/bin/python" -m pipeline.compute.skew_map || true
fi
ORB_COUNT="$(psql_su "$DBNAME" -tAc 'SELECT count(*) FROM orb_watch' | tr -d '[:space:]')"
if [ "${ORB_COUNT:-0}" = "0" ]; then
  "$REPO_DIR/.venv/bin/python" -m pipeline.compute.opening_range || true
fi
AN_COUNT="$(psql_su "$DBNAME" -tAc 'SELECT count(*) FROM analysis_names' | tr -d '[:space:]')"
if [ "${AN_COUNT:-0}" = "0" ]; then
  "$REPO_DIR/.venv/bin/python" -m pipeline.compute.stock_analysis || true
fi
Q_COUNT="$(psql_su "$DBNAME" -tAc 'SELECT count(*) FROM quantropy_names' | tr -d '[:space:]')"
if [ "${Q_COUNT:-0}" = "0" ]; then
  "$REPO_DIR/.venv/bin/python" -m pipeline.compute.quantropy || true
fi
BIAS_COUNT="$(psql_su "$DBNAME" -tAc 'SELECT count(*) FROM bias_names' | tr -d '[:space:]')"
if [ "${BIAS_COUNT:-0}" = "0" ]; then
  "$REPO_DIR/.venv/bin/python" -m pipeline.compute.daily_bias || true
fi
PERP_COUNT="$(psql_su "$DBNAME" -tAc 'SELECT count(*) FROM perp_names' | tr -d '[:space:]')"
if [ "${PERP_COUNT:-0}" = "0" ]; then
  "$REPO_DIR/.venv/bin/python" -m pipeline.compute.perps_desk || true
fi
ROT_COUNT="$(psql_su "$DBNAME" -tAc 'SELECT count(*) FROM sector_rotation_groups' | tr -d '[:space:]')"
if [ "${ROT_COUNT:-0}" = "0" ]; then
  "$REPO_DIR/.venv/bin/python" -m pipeline.compute.sector_rotation || true
fi

echo "Install complete."
