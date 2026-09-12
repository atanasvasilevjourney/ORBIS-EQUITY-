"""Tests for Wilder ADX helpers."""
import numpy as np
import pandas as pd

from pipeline.compute.adx import (
    ADX_TREND_MIN,
    adx_ok,
    adx_score,
    compute_adx_frame,
    latest_adx,
)


def _trending_ohlc(n: int = 120, seed: int = 1) -> tuple[pd.Series, pd.Series, pd.Series]:
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2020-01-01", periods=n)
    # Strong uptrend
    close = pd.Series(50 + np.arange(n) * 0.4 + rng.normal(0, 0.2, n), index=idx)
    high = close + 0.5
    low = close - 0.3
    return high, low, close


def test_adx_rising_in_uptrend():
    high, low, close = _trending_ohlc()
    frame = compute_adx_frame(high, low, close)
    assert "adx" in frame.columns
    # Late-window ADX should be meaningful in a clean trend
    assert float(frame["adx"].iloc[-1]) > 15
    assert float(frame["plus_di"].iloc[-1]) > float(frame["minus_di"].iloc[-1])


def test_adx_score_and_ok():
    assert adx_score(30, 25, 10) == 8.0
    assert adx_score(22, 20, 15) == 5.0
    assert adx_score(22, 10, 20) == 2.0
    assert adx_score(10, 20, 10) == 0.0
    assert adx_ok(22, 20, 15, ADX_TREND_MIN)
    assert not adx_ok(22, 10, 20, ADX_TREND_MIN)


def test_latest_adx_tuple():
    high, low, close = _trending_ohlc()
    adx, pdi, mdi = latest_adx(high, low, close)
    assert adx >= 0
    assert pdi >= 0
    assert mdi >= 0
