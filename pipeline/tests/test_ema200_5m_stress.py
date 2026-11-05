"""Offline tests for 5m EMA200 stress helpers (no Yahoo)."""
import pandas as pd

from pipeline.research.ema200_5m_stress import (
    attach_daily_ema200_step,
    drop_incomplete_cash_bar,
    features_5m_native,
)


def test_drop_incomplete_before_close():
    idx = pd.date_range("2026-11-05 09:35", periods=3, freq="5min", tz="America/New_York")
    bars = pd.DataFrame(
        {"open": [1, 1, 1], "high": [1, 1, 1], "low": [1, 1, 1], "close": [1, 1, 1], "volume": [1, 1, 1]},
        index=idx,
    )
    from datetime import datetime
    from zoneinfo import ZoneInfo

    now = datetime(2026, 11, 5, 10, 0, tzinfo=ZoneInfo("America/New_York"))
    trimmed = drop_incomplete_cash_bar(bars, now=now)
    assert len(trimmed) == 2


def test_daily_step_maps_flat_ema():
    idx5 = pd.date_range("2026-10-12 10:00", periods=20, freq="5min", tz="America/New_York")
    bars = pd.DataFrame(
        {
            "open": [100.0] * 20,
            "high": [101.0] * 20,
            "low": [99.0] * 20,
            "close": [100.0] * 20,
            "volume": [1000.0] * 20,
        },
        index=idx5,
    )
    daily_idx = pd.date_range("2026-09-01", periods=30, freq="B")
    daily = pd.DataFrame(
        {
            "open": [100.0] * 30,
            "high": [101.0] * 30,
            "low": [99.0] * 30,
            "close": [100.0] * 30,
            "volume": [1e6] * 30,
        },
        index=daily_idx,
    )
    merged = attach_daily_ema200_step(bars, daily, ema_period=5, history_min=5)
    assert merged["ema200_daily"].notna().all()
    assert merged["ribbon_dist_atr_daily"].iloc[-1] >= 0


def test_native_5m_features_need_200_bars():
    idx = pd.date_range("2026-01-02 09:30", periods=250, freq="5min", tz="America/New_York")
    close = pd.Series(range(250), dtype=float, index=idx) + 100
    ohlcv = pd.DataFrame(
        {
            "open": close,
            "high": close + 1,
            "low": close - 1,
            "close": close,
            "volume": 1000.0,
        }
    )
    feat = features_5m_native(ohlcv, history_min_bars=200)
    assert feat["ema200"].iloc[-1] == feat["ema200"].iloc[-1]  # computed
    assert pd.notna(feat["ema200"].iloc[-1])
