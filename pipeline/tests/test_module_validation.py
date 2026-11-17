"""Offline checks for the module-validation timing and the Carver series."""
from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline.compute.perps_math import blended_carver_forecast
from pipeline.research.module_validation import book_returns, carver_forecast_series


def test_signal_does_not_earn_the_bar_that_created_it():
    idx = pd.bdate_range("2020-01-01", periods=5)
    close = pd.Series([100.0, 100.0, 100.0, 200.0, 200.0], index=idx)
    frame = pd.DataFrame({"close": close})
    # The double happens on day 3. The signal flips that same close.
    pos = pd.Series([0.0, 0.0, 0.0, 1.0, 1.0], index=idx)
    net, gross, _exposure = book_returns({"AAA": frame}, {"AAA": pos}, cost_bps_per_side=0.0)
    assert abs(float(gross.iloc[3])) < 1e-12
    assert abs(float(net.iloc[3])) < 1e-12


def test_a_flip_pays_the_side_cost_on_the_next_session():
    idx = pd.bdate_range("2020-01-01", periods=4)
    close = pd.Series([100.0, 100.0, 100.0, 100.0], index=idx)
    frame = pd.DataFrame({"close": close})
    pos = pd.Series([0.0, 0.0, 1.0, 1.0], index=idx)
    net, gross, _exposure = book_returns({"AAA": frame}, {"AAA": pos}, cost_bps_per_side=10.0)
    assert abs(float(gross.iloc[3])) < 1e-12
    assert abs(float(net.iloc[3]) + 0.001) < 1e-12


def test_carver_series_matches_the_production_point_forecast():
    rng = np.random.default_rng(2)
    close = 80.0 * np.cumprod(1.0 + rng.normal(0.0003, 0.012, 500))
    series = carver_forecast_series(close)
    blended, _fast, _slow = blended_carver_forecast(close)
    assert abs(series[-1] - blended) < 1e-8
    mid = close[:360]
    mid_series = carver_forecast_series(mid)
    mid_point, _, _ = blended_carver_forecast(mid)
    assert abs(mid_series[-1] - mid_point) < 1e-8
