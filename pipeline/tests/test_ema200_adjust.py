"""Ribbon math must see adjusted high/low, not raw prints next to an adjusted close."""
import numpy as np
import pandas as pd
import pytest

from pipeline.clients.cash_eod import DailyBar
from pipeline.ema200_scanner.data.adjust import scale_ohlcv_frame
from pipeline.ema200_scanner.data.vendors.yahoo import _to_vendor
from pipeline.ema200_scanner.indicators.features import compute_features_frame
from pipeline.ema200_scanner.watchlist import classify_setup


def _series(n: int = 400) -> pd.DataFrame:
    idx = pd.date_range("2023-01-02", periods=n, freq="B")
    close = pd.Series(np.linspace(80, 120, n), index=idx)
    return pd.DataFrame(
        {
            "open": close - 0.5,
            "high": close + 1.0,
            "low": close - 1.0,
            "close": close,
            "volume": 1_000_000,
        },
        index=idx,
    )


def test_scale_puts_split_ohlc_on_the_adjusted_close():
    raw = _series()
    mixed = raw.copy()
    mixed.iloc[:200, mixed.columns.get_indexer(["open", "high", "low", "close"])] *= 4
    mixed["adj_close"] = raw["close"].to_numpy()
    scaled = scale_ohlcv_frame(mixed)
    assert scaled["close"].iloc[0] == raw["close"].iloc[0]
    assert scaled["high"].iloc[0] == raw["high"].iloc[0]
    assert scaled["high"].iloc[-1] == raw["high"].iloc[-1]


def test_close_only_adjustment_collapses_ribbon_distance():
    """Adjusting close but not high (the old loader) parks price inside a fake ribbon."""
    raw = _series()
    mixed = raw.copy()
    mixed.iloc[:200, mixed.columns.get_indexer(["open", "high", "low", "close"])] *= 4
    mixed["adj_close"] = raw["close"].to_numpy()

    close_only = mixed.copy()
    close_only["close"] = mixed["adj_close"]
    close_only = close_only.drop(columns=["adj_close"])

    kwargs = dict(ema_period=200, atr_period=14, history_min_bars=200, slope_lookback=20)
    adjusted = compute_features_frame(scale_ohlcv_frame(mixed), **kwargs)
    broken = compute_features_frame(close_only, **kwargs)

    assert broken["ema200_high"].iloc[-1] > adjusted["ema200_high"].iloc[-1] + 20
    assert broken["ribbon_dist_atr"].iloc[-1] < adjusted["ribbon_dist_atr"].iloc[-1]


def test_vendor_bar_scales_high_with_adj_close():
    bar = DailyBar(
        symbol="NVDA",
        date="2024-06-07",
        open=1200.0,
        high=1240.0,
        low=1180.0,
        close=1200.0,
        adj_close=120.0,
        volume=1_000,
        source="yahoo",
    )
    out = _to_vendor(bar, "yahoo")
    assert out.close == 120.0
    assert out.high == 124.0
    assert out.low == 118.0
    assert out.open == 120.0


def test_scaled_features_match_already_adjusted_series():
    raw = _series()
    mixed = raw.copy()
    mixed.iloc[:200, mixed.columns.get_indexer(["open", "high", "low", "close"])] *= 4
    mixed["adj_close"] = raw["close"].to_numpy()
    kwargs = dict(ema_period=200, atr_period=14, history_min_bars=200, slope_lookback=20)
    a = compute_features_frame(raw, **kwargs)
    b = compute_features_frame(scale_ohlcv_frame(mixed), **kwargs)
    assert b["ema200"].iloc[-1] == pytest.approx(a["ema200"].iloc[-1], rel=1e-9)
    assert b["ema200_high"].iloc[-1] == pytest.approx(a["ema200_high"].iloc[-1], rel=1e-9)
    assert b["ribbon_dist_atr"].iloc[-1] == pytest.approx(a["ribbon_dist_atr"].iloc[-1], rel=1e-9)
    row = b.iloc[-1].to_dict()
    # Both frames are the same series, so the label matches whichever side we score.
    assert classify_setup(row) == classify_setup(a.iloc[-1].to_dict())
