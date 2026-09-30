#!/usr/bin/env bash
# Weekday refresh: prices → signals → earnings → news
set -euo pipefail
cd "$(dirname "$0")/../.."
export PYTHONUNBUFFERED=1

echo "[daily] ingest prices"
python -m pipeline.ingest.prices

echo "[daily] cash EOD leftover backfill"
CASH_EOD_BARS="${CASH_EOD_BARS:-10}" \
CASH_EOD_LIMIT="${CASH_EOD_LIMIT:-80}" \
CASH_EOD_MAX_SEC="${CASH_EOD_MAX_SEC:-720}" \
python -m pipeline.ingest.cash_eod

echo "[daily] compute trend radar"
python -m pipeline.compute.trend_radar

echo "[daily] compute aggregates / daily brief"
python -m pipeline.compute.aggregates

echo "[daily] ingest earnings"
python -m pipeline.ingest.earnings

echo "[daily] ingest news"
python -m pipeline.ingest.news

echo "[daily] done"
