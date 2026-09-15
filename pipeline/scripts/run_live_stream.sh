#!/usr/bin/env bash
# Always-on London Strategic Edge live quote stream → Supabase live_quotes.
# Run on Render background worker / a VM — NOT GitHub Actions.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PYTHONUNBUFFERED=1

echo "[live] validate env"
python - <<'PY'
from pipeline.clients.lse_data import has_lse_data_key
from pipeline.utils.client import require_supabase_env
require_supabase_env()
if not has_lse_data_key():
    raise SystemExit("LSE_API_KEY (lse_live_…) required for live stream")
print("env OK")
PY

echo "[live] starting stream worker"
exec python -m pipeline.stream.live_quotes
