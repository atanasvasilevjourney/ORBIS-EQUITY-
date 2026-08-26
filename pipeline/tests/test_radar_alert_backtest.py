"""Offline tests for radar alert backtest helpers."""
import numpy as np
import pandas as pd

from pipeline.research.radar_alert_backtest import (
    build_radar_history,
    simulate_trades,
    summarize,
)


def _ohlcv(days: int = 220, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2020-01-01", periods=days)
    close = 100 * np.cumprod(1 + rng.normal(0.001, 0.015, days))
    high = close * (1 + rng.uniform(0, 0.01, days))
    low = close * (1 - rng.uniform(0, 0.01, days))
    open_ = close * (1 + rng.uniform(-0.005, 0.005, days))
    volume = rng.integers(1_000_000, 3_000_000, days).astype(float)
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume},
        index=idx,
    )


def test_build_radar_history_has_alert_columns():
    hist = build_radar_history(_ohlcv())
    assert "green_flip" in hist.columns
    assert "breakout_alert" in hist.columns
    assert "alert" in hist.columns
    assert "atr" in hist.columns
    assert "state" in hist.columns
    assert set(hist["state"].unique()).issubset({-1, 0, 1})


def test_simulate_trades_includes_atr_sizing():
    hist = build_radar_history(_ohlcv(260, seed=5))
    trades = simulate_trades("TEST", hist)
    for t in trades:
        assert t.entry_date <= t.exit_date
        assert t.bars_held >= 0
        if t.shares:
            assert t.stop_price is not None
            assert t.stop_price < t.entry_price
    s = summarize(trades)
    assert "n_trades" in s
    assert "atr_stop_exits" in s
