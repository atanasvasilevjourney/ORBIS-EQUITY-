"""EMA200 touch backtest / event detection smoke tests."""
import numpy as np
import pandas as pd

from pipeline.ema200_scanner.signals.ema200_touch import TouchParams, detect_events, events_only
from pipeline.research.ema200_backtest import (
    forward_stats,
    monte_carlo_trades,
    simulate_long_touch,
    split_close,
)


def _synthetic_uptrend(n: int = 700) -> pd.DataFrame:
    idx = pd.date_range("2020-01-01", periods=n, freq="B")
    close = 100 + np.cumsum(np.random.default_rng(0).normal(0.05, 0.4, n))
    close = np.maximum(close, 50)
    return pd.DataFrame(
        {
            "open": close,
            "high": close * 1.01,
            "low": close * 0.99,
            "close": close,
            "volume": 1_000_000,
        },
        index=idx,
    )


def test_detect_touch_events_runs():
    ohlcv = _synthetic_uptrend()
    params = TouchParams(history_min_bars=200, min_days_above=5, ema_period=50)
    ev = detect_events(ohlcv, params)
    assert "is_touch_bounce" in ev.columns
    bounces = events_only(ev)
    assert isinstance(bounces, pd.DataFrame)


def test_simulate_and_monte_carlo():
    ohlcv = _synthetic_uptrend()
    params = TouchParams(history_min_bars=200, min_days_above=5, ema_period=50)
    ev = detect_events(ohlcv, params)
    trades, rets = simulate_long_touch(ohlcv, ev)
    assert len(rets) == len(ohlcv) - 1
    mc = monte_carlo_trades(trades, n_sims=100)
    assert mc["n_sims"] == 100 or mc["n_sims"] == 0


def test_forward_stats_shape():
    ohlcv = _synthetic_uptrend(650)
    close = ohlcv["close"]
    idx = close.index[520:525]
    fwd = forward_stats(close, idx)
    assert "fwd_ret_5d" in fwd.columns
