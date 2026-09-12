#!/usr/bin/env bash
# Monday heavier refresh: universe + fundamentals + reports + F-Score + pharma
set -euo pipefail
cd "$(dirname "$0")/../.."
export PYTHONUNBUFFERED=1

echo "[weekly] universe sync"
python -m pipeline.ingest.universe

echo "[weekly] fundamentals"
python -m pipeline.ingest.fundamentals

echo "[weekly] financial reports"
python -m pipeline.ingest.financial_reports

echo "[weekly] F-Score"
python -m pipeline.compute.f_score

echo "[weekly] pharma trials"
python -m pipeline.ingest.pharma_trials

echo "[weekly] pharma signals"
python -m pipeline.compute.pharma_signals

echo "[weekly] done — follow with run_daily.sh on the same day"
