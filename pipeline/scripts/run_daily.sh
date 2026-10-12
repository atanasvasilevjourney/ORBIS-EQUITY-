#!/usr/bin/env bash
# Weekday refresh: ingest → compute (all desks) → earnings → news
# Mirrors .github/workflows/nightly-pipeline.yml daily path (Render backup cron).
set -euo pipefail
cd "$(dirname "$0")/../.."
export PYTHONUNBUFFERED=1

echo "[daily] ingest prices"
python -m pipeline.ingest.prices

echo "[daily] cash EOD backfill (Yahoo → Stooq)"
export CASH_EOD_BARS="${CASH_EOD_BARS:-10}"
export CASH_EOD_LIMIT="${CASH_EOD_LIMIT:-80}"
export CASH_EOD_MAX_SEC="${CASH_EOD_MAX_SEC:-720}"
python -m pipeline.ingest.cash_eod || echo "[daily] cash_eod skipped"

bash pipeline/scripts/run_compute_signals.sh

echo "[daily] ingest earnings"
python -m pipeline.ingest.earnings

echo "[daily] ingest news"
python -m pipeline.ingest.news

echo "[daily] done"
