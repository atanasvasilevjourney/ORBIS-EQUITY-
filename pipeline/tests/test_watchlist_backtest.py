"""Offline tests for production watchlist backtest helpers."""
import numpy as np
import pandas as pd
import pytest

from pipeline.compute.trend_radar import MIN_HISTORY_DAYS
from pipeline.research.watchlist_backtest import (
    build_watchlist_history,
    simulate_watchlist_trades,
    summarize,
)


def _watchlist_day_frame(
    *,
    n_prior: int,
    day_pct: float,
    rel_vol_today: float,
    prior_vol: float = 1_000_000.0,
) -> pd.DataFrame:
    """Build OHLCV ending in a single watchlist candidate day."""
    n = n_prior + 1
    closes = [100.0] * n_prior + [100.0 * (1 + day_pct / 100.0)]
    highs = [c * 1.001 for c in closes]
    highs[-1] = closes[-1]
    volumes = [prior_vol] * n_prior + [prior_vol * rel_vol_today]
    idx = pd.bdate_range("2024-01-01", periods=n)
    return pd.DataFrame(
        {
            "open": closes,
            "high": highs,
            "low": [c * 0.999 for c in closes],
            "close": closes,
            "volume": volumes,
        },
        index=idx,
    )


def test_build_watchlist_history_uses_production_states():
    df = _watchlist_day_frame(n_prior=MIN_HISTORY_DAYS, day_pct=5.0, rel_vol_today=3.0)
    hist = build_watchlist_history(df)
    assert not hist.empty
    assert hist.iloc[-1]["state"] == 1
    assert hist.iloc[-1]["day_pct"] == pytest.approx(5.0, rel=1e-3)


def test_simulate_trades_on_list_flip_next_open_to_close():
    signal = _watchlist_day_frame(n_prior=MIN_HISTORY_DAYS, day_pct=6.0, rel_vol_today=2.5)
    # Extra day for entry/exit
    extra = pd.DataFrame(
        {
            "open": [106.0],
            "high": [108.0],
            "low": [105.0],
            "close": [107.0],
            "volume": [2_000_000.0],
        },
        index=pd.bdate_range(signal.index[-1] + pd.Timedelta(days=1), periods=1),
    )
    df = pd.concat([signal, extra])
    trades = simulate_watchlist_trades("TEST", df)
    assert len(trades) >= 1
    t = trades[-1]
    assert t.entry_price == pytest.approx(106.0)
    assert t.exit_price == pytest.approx(107.0)
    assert t.return_pct == pytest.approx((107 / 106 - 1) * 100, rel=1e-4)


def test_summarize_empty():
    s = summarize([])
    assert s["n_trades"] == 0
