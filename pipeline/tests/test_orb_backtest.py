"""Unit tests for ORB intraday simulation (synthetic bars)."""
from __future__ import annotations

from datetime import date

import pandas as pd
from zoneinfo import ZoneInfo

from pipeline.research.orb_backtest import (
    OrbParams,
    opening_range_with_params,
    simulate_orb_trade,
)

NY = ZoneInfo("America/New_York")


def _bar(ts: str, o: float, h: float, l: float, c: float) -> dict:
    t = pd.Timestamp(ts).tz_localize(NY)
    return {"Open": o, "High": h, "Low": l, "Close": c, "index": t}


def _frame(rows: list[dict]) -> pd.DataFrame:
    idx = [r.pop("index") for r in rows]
    return pd.DataFrame(rows, index=idx)


def test_opening_range_breakout_and_target_hit():
    session = date(2026, 10, 14)
    # OR 09:30-09:45: high 10.50, low 10.00 -> range 0.50
    bars = _frame(
        [
            _bar("2026-10-14 09:30", 10.1, 10.4, 10.0, 10.2),
            _bar("2026-10-14 09:35", 10.2, 10.5, 10.1, 10.45),
            _bar("2026-10-14 09:40", 10.45, 10.5, 10.05, 10.1),
            _bar("2026-10-14 09:45", 10.15, 10.55, 10.1, 10.52),  # breakout close
            _bar("2026-10-14 09:50", 10.52, 11.10, 10.5, 11.0),  # hits target 10.52+0.5
        ]
    )
    rng = opening_range_with_params(bars, session, or_minutes=15)
    assert rng["status"] == "BREAKOUT"
    assert rng["entry"] == 10.52

    tr = simulate_orb_trade(bars, session, "TEST", gap=5.0, params=OrbParams(equity=100_000))
    assert tr is not None
    assert tr.exit_reason in ("TARGET", "TARGET_GAP")
    assert tr.r_multiple == 1.0


def test_stop_before_target_same_bar():
    session = date(2026, 10, 15)
    bars = _frame(
        [
            _bar("2026-10-15 09:30", 20.0, 20.5, 19.8, 20.2),
            _bar("2026-10-15 09:40", 20.2, 20.6, 19.9, 20.55),
            _bar("2026-10-15 09:45", 20.56, 20.62, 20.54, 20.61),  # breakout > OR high 20.6
            _bar("2026-10-15 09:55", 20.61, 20.70, 19.75, 20.0),  # wide bar hits stop
        ]
    )
    tr = simulate_orb_trade(bars, session, "TEST", gap=6.0, params=OrbParams())
    assert tr is not None
    assert tr.exit_reason in ("STOP", "STOP_SAME_BAR")
