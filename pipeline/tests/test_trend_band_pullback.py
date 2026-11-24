"""pb_ema EMA200 high/low band pullback tests."""
from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline.trend_band_scanner.indicators.band import compute_pb_ema_band_frame, resample_to_weekly
from pipeline.trend_band_scanner.signals.pullback import scan_frame


def _synthetic_uptrend_pullback(n: int = 280) -> pd.DataFrame:
    t = np.arange(n, dtype=float)
    close = 50.0 + t * 0.09
    peak = close.copy()
    close[-6:] = peak[-6:] * np.linspace(0.992, 0.976, 6)
    high = np.maximum(peak, close) + 0.5
    high[-8:] = peak[-8:] + 1.5
    low = close - 1.0
    low[-3:] = close[-3:] - 1.3
    return pd.DataFrame(
        {
            "date": pd.date_range("2018-01-01", periods=n, freq="B"),
            "open": close,
            "high": high,
            "low": low,
            "close": close,
            "volume": 1_000_000,
        }
    )


def test_ema200_band_edges():
    df = _synthetic_uptrend_pullback()
    band = compute_pb_ema_band_frame(
        df[["close", "high", "low"]],
        ema_period=200,
        history_min_bars=200,
        slope_lookback=20,
    )
    assert band["band_hi"].iloc[-1] >= band["band_lo"].iloc[-1]
    assert band["band_rising"].iloc[-1]


def test_scan_daily_pullback():
    df = _synthetic_uptrend_pullback()
    cfg = {
        "ema_period": 200,
        "history_min_bars": 200,
        "band": {"slope_lookback_daily": 20, "min_band_slope_pct": 0.0},
        "pullback": {
            "swing_high_lookback_daily": 30,
            "min_advance_pct": 2.0,
            "min_pullback_pct": 1.0,
            "max_pullback_pct": 30.0,
            "proximity_pct": 12.0,
        },
        "band_flip": {"flip_lookback_daily": 12},
        "scan": {"spark_bars_daily": 40},
    }
    hit = scan_frame(df, cfg, timeframe="1d")
    assert hit is not None
    assert hit["invalidation"] == hit["ema200_low"]
    assert hit["band_hi"] == hit["ema200_high"]


def test_weekly_resample_and_scan():
    daily = _synthetic_uptrend_pullback(320)
    weekly = resample_to_weekly(daily)
    assert len(weekly) >= 50
    cfg = {
        "weekly_history_min_bars": 50,
        "history_min_bars": 50,
        "band": {"slope_lookback_weekly": 4, "min_band_slope_pct": 0.0},
        "pullback": {
            "swing_high_lookback_weekly": 8,
            "min_advance_pct": 2.0,
            "min_pullback_pct": 0.5,
            "max_pullback_pct": 35.0,
            "proximity_pct": 8.0,
        },
        "band_flip": {"flip_lookback_weekly": 4},
        "scan": {"spark_bars_weekly": 20},
    }
    hit = scan_frame(weekly, cfg, timeframe="1wk")
    assert hit is None or hit["timeframe"] == "1wk"


def test_scan_rejects_close_below_ema200_low():
    df = _synthetic_uptrend_pullback()
    df.loc[df.index[-1], "close"] = 10.0
    cfg = {"history_min_bars": 200, "pullback": {}, "band_flip": {}, "scan": {}}
    assert scan_frame(df, cfg, timeframe="1d") is None