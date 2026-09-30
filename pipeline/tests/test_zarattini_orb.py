"""Smoke test Zarattini ORB engine on synthetic 5m bars."""

from datetime import datetime

import pandas as pd

from pipeline.research.zarattini_orb import BacktestConfig, run_opening_bias_backtest


def _session_day(day: str) -> pd.DataFrame:
    base = pd.Timestamp(f"{day} 09:30:00")
    rows = []
    for i, minute in enumerate([30, 35, 40, 45, 50]):
        ts = base + pd.Timedelta(minutes=minute - 30 if i == 0 else (minute - 30))
        if i == 0:
            o, h, l, c = 100.0, 101.0, 99.5, 100.8  # bullish signal
        elif i == 1:
            o, h, l, c = 100.8, 102.0, 100.5, 101.5  # entry bar
        else:
            o, h, l, c = 101.0, 101.5, 100.0, 100.5
        rows.append({"date": datetime(2024, 6, 3, 9, minute), "open": o, "high": h, "low": l, "close": c})
    return pd.DataFrame(rows)


def test_long_trade_stop_or_close():
    bars = _session_day("2024-06-03")
    res = run_opening_bias_backtest("TEST", bars, BacktestConfig(initial_equity=50_000))
    assert len(res.trades) == 1
    assert res.trades[0].direction == "long"
