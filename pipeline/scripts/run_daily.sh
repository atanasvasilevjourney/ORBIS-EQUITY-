#!/usr/bin/env bash
# Weekday refresh: prices → signals → earnings → news
set -euo pipefail
cd "$(dirname "$0")/../.."
export PYTHONUNBUFFERED=1

echo "[daily] ingest prices (run pipeline.ingest.us_index_universe weekly to refresh SP500+NDX100 members)"
python -m pipeline.ingest.prices

echo "[daily] compute trend radar"
python -m pipeline.compute.trend_radar

echo "[daily] ema200 watchlist features"
python -m pipeline.ema200_scanner.jobs.nightly || echo "[daily] ema200 nightly skipped (check migration 021 / env)"

echo "[daily] compute aggregates / daily brief"
python -m pipeline.compute.aggregates

echo "[daily] ingest earnings"
python -m pipeline.ingest.earnings

echo "[daily] ingest news"
python -m pipeline.ingest.news

echo "[daily] done"
