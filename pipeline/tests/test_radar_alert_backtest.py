"""Offline tests for radar alert backtest helpers."""
import numpy as np
import pandas as pd

from pipeline.compute.trail_exit import CooldownTracker
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
    assert "adx" in hist.columns
    assert "entry_timing" in hist.columns
    assert "sma20" in hist.columns
    assert "state" in hist.columns
    assert set(hist["state"].unique()).issubset({-1, 0, 1})
    assert set(hist["entry_timing"].unique()).issubset({"ok", "wait_pullback", "too_late"})


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


def test_simulate_sma20_trail_mode():
    hist = build_radar_history(_ohlcv(280, seed=7))
    trades = simulate_trades(
        "TEST",
        hist,
        exit_mode="sma20_trail",
        use_cooldown=True,
        skip_too_late=True,
    )
    for t in trades:
        assert t.entry_timing in (None, "ok", "wait_pullback", "too_late")
    s = summarize(trades)
    assert "trail_exits" in s


def test_cooldown_integration_skips_after_losses():
    """Cooldown can only reduce or equal trade count vs no-cooldown."""
    hist = build_radar_history(_ohlcv(260, seed=3))
    with_cd = simulate_trades("TEST", hist, use_cooldown=True, exit_mode="red_only")
    without = simulate_trades("TEST", hist, use_cooldown=False, exit_mode="red_only")
    assert len(with_cd) <= len(without)
    assert isinstance(CooldownTracker(), CooldownTracker)
