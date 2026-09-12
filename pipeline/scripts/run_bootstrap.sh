#!/usr/bin/env bash
# One-shot seed: S&P 500 + ~400d yfinance history + radar + aggregates.
# Run manually on Render BEFORE relying on daily crons.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PYTHONUNBUFFERED=1
python -m pipeline.bootstrap
echo "Bootstrap complete."
