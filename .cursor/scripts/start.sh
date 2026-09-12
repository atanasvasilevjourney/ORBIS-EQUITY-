#!/usr/bin/env bash
# Per-boot startup: bring up the database stack (Postgres + PostgREST + nginx).
# The Next.js dev server runs as a terminal (see .cursor/environment.json).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/common.sh"

ensure_postgres
ensure_postgrest
ensure_nginx

echo "KovaView data stack ready:"
echo "  Postgres  127.0.0.1:$PGPORT  (db=$DBNAME)"
echo "  PostgREST 127.0.0.1:$PGREST_PORT"
echo "  Gateway   http://127.0.0.1:$GATEWAY_PORT (Supabase REST at /rest/v1)"
