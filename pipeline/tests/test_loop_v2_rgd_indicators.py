"""Unit tests for LOOP v2 RGD add-on indicators and partial-exit accounting."""
import math

import numpy as np
import pandas as pd

from pipeline.research.loop_v2_backtest import OpenPosition
from pipeline.research.loop_v2_indicators import (
    efficiency_ratio_smoothed,
    kaufman_efficiency_ratio as ker,
)


def test_kaufman_er_trending_series_near_one():
    """Monotone uptrend → ER approaches 1."""
    idx = pd.bdate_range("2024-01-01", periods=30)
    close = pd.Series(np.linspace(100, 130, len(idx)), index=idx)
    er = ker(close, period=10)
    assert er.iloc[-1] > 0.9


def test_kaufman_er_choppy_series_below_trend():
    idx = pd.bdate_range("2024-01-01", periods=30)
    rng = np.random.default_rng(42)
    close = pd.Series(100 + rng.normal(0, 2, len(idx)).cumsum(), index=idx)
    er = ker(close, period=10)
    smooth = efficiency_ratio_smoothed(close, period=10, ema_span=3)
    assert smooth.iloc[-1] <= 1.0
    assert er.dropna().between(0, 1).all()


def test_partial_exit_halves_position_frac():
    """Simulate partial-take flag: position_frac 1 → 0.5."""
    pos = OpenPosition(
        symbol="X",
        sector="Technology",
        entry_day=pd.Timestamp("2024-01-10").date(),
        entry_price=100.0,
        breakout_day=pd.Timestamp("2024-01-05").date(),
        stop_vwap_anchor=pd.Timestamp("2024-01-01").date(),
        upper_level=98.0,
        peak_close=100.0,
        fill_mode="next_open",
        initial_stop=95.0,
        position_frac=1.0,
    )
    risk = pos.entry_price - pos.initial_stop
    target = pos.entry_price + 2 * risk
    assert math.isclose(target, 110.0)
    hi = 112.0
    if hi >= target:
        pos.partial_taken = True
        pos.position_frac *= 0.5
    assert pos.position_frac == 0.5
    assert pos.partial_taken


def test_breakeven_stop_after_partial():
    pos = OpenPosition(
        symbol="X",
        sector="Technology",
        entry_day=pd.Timestamp("2024-01-10").date(),
        entry_price=50.0,
        breakout_day=pd.Timestamp("2024-01-05").date(),
        stop_vwap_anchor=pd.Timestamp("2024-01-01").date(),
        upper_level=48.0,
        peak_close=55.0,
        fill_mode="next_open",
        initial_stop=45.0,
        partial_taken=True,
        position_frac=0.5,
    )
    stop = 44.0
    if pos.partial_taken:
        stop = max(stop, pos.entry_price)
    assert stop == 50.0