"""Trend-band pullback scanner tests."""
from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline.trend_band_scanner.indicators.band import compute_band_frame
from pipeline.trend_band_scanner.signals.pullback import scan_frame


def _synthetic_uptrend_pullback(n: int = 120) -> pd.DataFrame:
    """Rising band with price advance then pullback to the cloud."""
    t = np.arange(n, dtype=float)
    close = 80.0 + t * 0.15 + np.sin(t / 8) * 0.5
    # Late pullback toward band
    close[-10:] -= np.linspace(6.0, 2.0, 10)
    high = close + 0.6
    low = close - 0.8
    low[-3:] -= 1.5
    return pd.DataFrame(
        {
            "date": pd.date_range("2024-01-01", periods=n, freq="B"),
            "open": close,
            "high": high,
            "low": low,
            "close": close,
            "volume": 1_000_000,
        }
    )


def test_band_rising_on_uptrend():
    df = _synthetic_uptrend_pullback()
    band = compute_band_frame(df["close"], ema_fast=20, ema_slow=50)
    assert band["band_rising"].iloc[-1]


def test_scan_finds_pullback():
    df = _synthetic_uptrend_pullback()
    cfg = {
        "ema_fast": 20,
        "ema_slow": 50,
        "slope_lookback": 5,
        "min_band_slope_pct": 0.01,
        "pullback": {
            "swing_high_lookback": 30,
            "min_advance_pct": 3.0,
            "min_pullback_pct": 1.0,
            "max_pullback_pct": 30.0,
            "proximity_pct": 5.0,
            "low_touch_extra_pct": 2.0,
        },
        "band_flip": {"flip_lookback_days": 12},
        "scan": {"spark_bars": 40},
    }
    hit = scan_frame(df, cfg)
    assert hit is not None
    assert hit["setup_kind"] in ("pullback", "band_flip")
    assert hit["score"] > 0
    assert hit["invalidation"] <= hit["band_lo"] + 0.01
    assert len(hit["spark"]) >= 10


def test_scan_rejects_breakdown():
    df = _synthetic_uptrend_pullback()
    df.loc[df.index[-1], "close"] = 50.0
    df.loc[df.index[-1], "low"] = 49.0
    cfg = {"ema_fast": 20, "ema_slow": 50, "pullback": {}, "band_flip": {}, "scan": {}}
    assert scan_frame(df, cfg) is None