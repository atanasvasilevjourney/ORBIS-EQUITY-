"""Unit tests for ATR risk sizing."""
import math

import numpy as np
import pandas as pd
import pytest

from pipeline.compute.atr_risk import (
    ATR_STOP_MULTIPLIER,
    RISK_PER_TRADE_PCT,
    compute_atr,
    long_stop_price,
    size_long_position,
    stop_distance,
)


def test_stop_distance_and_price():
    assert stop_distance(2.0) == pytest.approx(2.0 * ATR_STOP_MULTIPLIER)
    assert long_stop_price(100.0, 2.0) == pytest.approx(100.0 - 5.0)


def test_size_long_position_basic():
    plan = size_long_position(
        equity=100_000,
        buying_power=100_000,
        entry_price=100.0,
        atr=2.0,
    )
    # dollar_risk = 1250; stop_dist = 5; shares = floor(1250/5) = 250
    assert plan.rejected_reason is None
    assert plan.shares == 250
    assert plan.stop_price == pytest.approx(95.0)
    assert plan.dollar_risk == pytest.approx(100_000 * RISK_PER_TRADE_PCT)


def test_size_rejects_invalid_atr():
    plan = size_long_position(
        equity=100_000, buying_power=100_000, entry_price=50.0, atr=0.0
    )
    assert plan.shares == 0
    assert plan.rejected_reason == "invalid candidate data"


def test_buying_power_cap():
    plan = size_long_position(
        equity=100_000,
        buying_power=1_000,  # only $1k BP
        entry_price=100.0,
        atr=2.0,
    )
    assert plan.shares == 10  # floor(1000/100)
    assert plan.position_value == pytest.approx(1000.0)


def test_compute_atr_length():
    n = 40
    df = pd.DataFrame({
        "high": np.linspace(101, 140, n),
        "low": np.linspace(99, 138, n),
        "close": np.linspace(100, 139, n),
    })
    atr = compute_atr(df, period=14)
    assert len(atr) == n
    assert math.isfinite(float(atr.iloc[-1]))
