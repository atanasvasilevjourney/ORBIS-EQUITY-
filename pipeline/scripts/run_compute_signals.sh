#!/usr/bin/env bash
# Desk compute chain — keep in sync with .github/workflows/nightly-pipeline.yml (compute-signals job).
set -euo pipefail
cd "$(dirname "$0")/../.."
export PYTHONUNBUFFERED=1

run_required() {
  echo "[compute] $1"
  python -m "$1"
}

run_optional() {
  echo "[compute] $1 (optional)"
  python -m "$1" || echo "[compute] $1 skipped or failed (non-fatal)"
}

run_required pipeline.compute.trend_radar
run_optional pipeline.notify.alert_digest
run_required pipeline.compute.aggregates
run_required pipeline.compute.f_score
run_required pipeline.compute.factor_scores
run_required pipeline.compute.portfolio_loop
run_required pipeline.compute.skew_map
run_required pipeline.compute.opening_range
run_required pipeline.compute.stock_analysis
run_required pipeline.compute.quantropy
run_optional pipeline.compute.daily_bias
run_optional pipeline.compute.perps_desk
run_optional pipeline.compute.sector_rotation

echo "[compute] ema200 watchlist features"
python -m pipeline.ema200_scanner.jobs.nightly || echo "[compute] ema200 nightly skipped"

echo "[compute] triangle pattern scan"
python -m pipeline.triangle_scanner.jobs.nightly || echo "[compute] triangle nightly skipped"

echo "[compute] signals done"
