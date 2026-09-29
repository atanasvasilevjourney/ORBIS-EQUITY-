#!/usr/bin/env bash
# Monday heavier refresh: universe + fundamentals + reports + F-Score
set -euo pipefail
cd "$(dirname "$0")/../.."
export PYTHONUNBUFFERED=1

echo "[weekly] US index universe (S&P 500 + Nasdaq-100, ex biotech/pharma names)"
python -m pipeline.ingest.us_index_universe

echo "[weekly] universe sync (LSE catalog tiers)"
python -m pipeline.ingest.universe

echo "[weekly] fundamentals"
python -m pipeline.ingest.fundamentals

echo "[weekly] financial reports"
python -m pipeline.ingest.financial_reports

echo "[weekly] F-Score"
python -m pipeline.compute.f_score

echo "[weekly] done — follow with run_daily.sh on the same day"
