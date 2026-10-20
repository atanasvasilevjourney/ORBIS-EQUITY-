"""Fast research validation gate (no network). Run in CI via pytest or directly.

    python -m pipeline.jobs.loop_research_gate
"""
from __future__ import annotations

import subprocess
import sys


def main() -> int:
    cmd = [
        sys.executable,
        "-m",
        "pytest",
        "pipeline/tests/test_top_green_lag.py",
        "pipeline/tests/test_donchian_vwap_backtest_smoke.py",
        "pipeline/tests/test_backtest_regime_gate.py",
        "-q",
        "--tb=short",
    ]
    print("Running LOOP research gate:", " ".join(cmd))
    return subprocess.call(cmd)


if __name__ == "__main__":
    raise SystemExit(main())
