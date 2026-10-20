"""Offline smoke tests for Donchian portfolio backtest (lag + costs)."""

from __future__ import annotations

from datetime import date

import pandas as pd

from pipeline.research.donchian_vwap_backtest import run_donchian_vwap_portfolio


def _panel(days, opens, closes):
    return pd.DataFrame(
        {
            "open": opens,
            "high": closes,
            "low": opens,
            "close": closes,
            "volume": 1_000_000,
        },
        index=pd.DatetimeIndex(days),
    )


def _signals(days, eligible_from: int):
    n = len(days)
    return pd.DataFrame(
        {
            "close": [100.0] * n,
            "upper": [99.0] * n,
            "lower": [90.0] * n,
            "vwap": [95.0] * n,
            "eligible": [i >= eligible_from for i in range(n)],
            "exit_signal": [False] * n,
            "strength": [1.0 if i >= eligible_from else 0.0 for i in range(n)],
        },
        index=pd.DatetimeIndex(days),
    )


def test_eligibility_on_signal_day_not_entry_day():
    """Eligible only on day 5 close must not enter using that bar on day 5 (uses t-1)."""
    days = pd.bdate_range("2026-03-02", periods=10)
    spy = _panel(days, [100] * 10, [100] * 10)
    opens = [100, 100, 100, 100, 100, 150, 150, 150, 150, 150]
    closes = opens
    panels = {"SPY": spy, "AAA": _panel(days, opens, closes)}
    signals = {"AAA": _signals(days, eligible_from=5)}
    start = days[0].date()
    end = days[-1].date()

    daily, _ = run_donchian_vwap_portfolio(
        start,
        end,
        panels=panels,
        signals=signals,
        sym_sector={"AAA": "Technology"},
        exit_mode="donchian20",
    )
    assert not daily.empty
    # If we entered on the gap day (lookahead), day-5 return would be huge.
    assert float(daily.iloc[5]) < 0.05


def test_backtest_runs_with_injected_universe():
    days = pd.bdate_range("2026-03-02", periods=8)
    spy = _panel(days, [100] * 8, [100] * 8)
    closes = [100 + i for i in range(8)]
    panels = {"SPY": spy, "AAA": _panel(days, closes, closes)}
    signals = {"AAA": _signals(days, eligible_from=0)}
    daily, eq = run_donchian_vwap_portfolio(
        days[0].date(),
        days[-1].date(),
        panels=panels,
        signals=signals,
        sym_sector={"AAA": "Technology"},
    )
    assert len(daily) == len(eq)
    assert float(eq["equity"].iloc[-1]) > 0
