"""EMA200 seeding and TradingView-style EMA tests."""
import math

import numpy as np
import pytest

from pipeline.ema200_scanner.indicators.ema import apply_trust_window, ema_pine, ema_series


def test_ema_pine_sma_seed_and_recursion():
    close = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    out = ema_pine(close, period=3)
    assert math.isnan(out[0])
    assert math.isnan(out[1])
    assert out[2] == pytest.approx(2.0)
    assert out[3] == pytest.approx(3.0)
    assert out[4] == pytest.approx(4.0)


def test_trust_window_masks_early_bars():
    close = np.arange(1, 601, dtype=float)
    ema = ema_series(close, period=200)
    trusted = apply_trust_window(ema, history_min_bars=500)
    assert math.isnan(trusted.iloc[498])
    assert not math.isnan(trusted.iloc[499])
    assert not math.isnan(trusted.iloc[-1])


def test_ema_requires_full_period():
    close = np.array([10.0, 11.0])
    out = ema_pine(close, period=200)
    assert np.all(np.isnan(out))
