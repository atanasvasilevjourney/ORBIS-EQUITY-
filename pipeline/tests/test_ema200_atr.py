"""ATR helper used by EMA200 features."""
import math

import numpy as np
import pandas as pd
import pytest

from pipeline.compute.atr_risk import compute_atr
from pipeline.ema200_scanner.indicators.features import compute_features_frame


def test_compute_atr_finite_tail():
    n = 40
    df = pd.DataFrame(
        {
            "high": np.linspace(101, 140, n),
            "low": np.linspace(99, 138, n),
            "close": np.linspace(100, 139, n),
            "volume": np.full(n, 1_000_000),
        }
    )
    atr = compute_atr(df, period=14)
    assert len(atr) == n
    assert math.isfinite(float(atr.iloc[-1]))


def test_features_include_atr_and_dist():
    n = 600
    idx = pd.date_range("2020-01-01", periods=n, freq="B")
    close = np.linspace(50, 150, n)
    df = pd.DataFrame(
        {
            "open": close,
            "high": close + 1,
            "low": close - 1,
            "close": close,
            "volume": np.full(n, 2_000_000),
        },
        index=idx,
    )
    feat = compute_features_frame(
        df,
        ema_period=200,
        atr_period=14,
        history_min_bars=500,
        slope_lookback=20,
        regime="bull",
    )
    last = feat.iloc[-1]
    assert math.isfinite(float(last["atr14"]))
    assert math.isfinite(float(last["dist_atr"]))
    assert last["regime"] == "bull"
