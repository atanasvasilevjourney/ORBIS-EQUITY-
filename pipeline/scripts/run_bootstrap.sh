#!/usr/bin/env bash
# One-shot seed: S&P 500 + ~400d yfinance history + radar + aggregates + factors.
# Run manually on Render BEFORE relying on daily crons.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PYTHONUNBUFFERED=1

echo "[bootstrap] validate env"
python - <<'PY'
from pipeline.utils.client import require_supabase_env
url, _ = require_supabase_env()
print(f"Supabase OK: {url}")
PY

python -m pipeline.bootstrap
echo "Bootstrap complete."
