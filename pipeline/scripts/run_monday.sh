#!/usr/bin/env bash
# Monday on Render: weekly ingest + deep cash EOD + full daily chain (backup after GitHub 19:30 UTC).
set -euo pipefail
cd "$(dirname "$0")/../.."
export PYTHONUNBUFFERED=1

bash pipeline/scripts/run_weekly.sh

export CASH_EOD_BARS=300
export CASH_EOD_LIMIT=250
export CASH_EOD_MAX_SEC=720
bash pipeline/scripts/run_daily.sh

echo "[monday] weekly + daily complete"
