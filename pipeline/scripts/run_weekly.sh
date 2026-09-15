#!/usr/bin/env bash
# Monday heavier refresh: universe + fundamentals + reports + F-Score + pharma + factors
set -euo pipefail
cd "$(dirname "$0")/../.."
export PYTHONUNBUFFERED=1

run_step() {
  local label="$1"
  shift
  echo "[weekly] ${label}"
  if "$@"; then
    echo "[weekly] ${label} OK"
  else
    echo "[weekly] WARN: ${label} failed (exit $?) — continuing"
  fi
}

echo "[weekly] validate env"
python - <<'PY'
from pipeline.utils.client import require_supabase_env
url, _ = require_supabase_env()
print(f"Supabase OK: {url}")
PY

echo "[weekly] universe sync"
python -m pipeline.ingest.universe

run_step "fundamentals" python -m pipeline.ingest.fundamentals
run_step "financial reports" python -m pipeline.ingest.financial_reports
run_step "F-Score" python -m pipeline.compute.f_score
run_step "factor scores" python -m pipeline.compute.factor_scores
run_step "pharma trials" python -m pipeline.ingest.pharma_trials
run_step "pharma signals" python -m pipeline.compute.pharma_signals

echo "[weekly] done — follow with run_daily.sh on the same day"
