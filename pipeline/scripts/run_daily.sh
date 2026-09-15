#!/usr/bin/env bash
# Weekday refresh — prices + core signals + desk modules the cockpit reads.
# Individual desk steps are soft-fail so one broken module does not block brief/radar.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PYTHONUNBUFFERED=1

run_step() {
  local label="$1"
  shift
  echo "[daily] ${label}"
  if "$@"; then
    echo "[daily] ${label} OK"
  else
    echo "[daily] WARN: ${label} failed (exit $?) — continuing"
  fi
}

echo "[daily] validate env"
python - <<'PY'
from pipeline.utils.client import require_supabase_env
url, _ = require_supabase_env()
print(f"Supabase OK: {url}")
PY

echo "[daily] ingest prices (LSE / yfinance / cash EOD fallback)"
python -m pipeline.ingest.prices

run_step "cash EOD backfill (Yahoo/Stooq)" python -m pipeline.ingest.cash_eod

echo "[daily] compute trend radar"
python -m pipeline.compute.trend_radar

run_step "alert digest" python -m pipeline.notify.alert_digest

echo "[daily] compute aggregates / daily brief"
python -m pipeline.compute.aggregates

run_step "factor scores" python -m pipeline.compute.factor_scores
run_step "portfolio loop" python -m pipeline.compute.portfolio_loop
run_step "skew map" python -m pipeline.compute.skew_map
run_step "opening range" python -m pipeline.compute.opening_range
run_step "stock analysis" python -m pipeline.compute.stock_analysis
run_step "quantropy" python -m pipeline.compute.quantropy
run_step "daily bias" python -m pipeline.compute.daily_bias
run_step "perps desk" python -m pipeline.compute.perps_desk
run_step "sector rotation" python -m pipeline.compute.sector_rotation

echo "[daily] ingest earnings"
python -m pipeline.ingest.earnings

echo "[daily] ingest news"
python -m pipeline.ingest.news

echo "[daily] done"
