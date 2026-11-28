from __future__ import annotations

from datetime import date

import pandas as pd

from pipeline.research.loop_overlay_harness import (
    _apply_exposure_overlay,
    compute_pit_breadth_series,
    overlay_metrics,
)
from pipeline.strategies.costs import CostModel


def _ohlc(days, closes):
    return pd.DataFrame(
        {
            "open": closes,
            "high": [c * 1.01 for c in closes],
            "low": [c * 0.99 for c in closes],
            "close": closes,
            "volume": [1_000_000.0] * len(closes),
        },
        index=pd.DatetimeIndex(days),
    )


def test_apply_exposure_turnover_cost():
    idx = pd.Series([0.01, 0.01, 0.01], index=pd.date_range("2024-01-02", periods=3))
    cash = pd.Series([0.0, 0.0, 0.0], index=idx.index)
    exp = pd.Series([0.0, 1.0, 1.0], index=idx.index)
    net, _ = _apply_exposure_overlay(idx, cash, exp, cost=CostModel(5, 5))
    assert net.iloc[1] < 0.01


def test_breadth_counts_eligible_only():
    days = pd.bdate_range("2024-06-03", periods=5)
    sig = pd.DataFrame(
        {
            "eligible": [True, False, True, False, True],
            "exit_signal": False,
            "strength": 0.1,
        },
        index=days,
    )
    signals = {"AAA": sig, "BBB": sig.copy()}
    pit = lambda d: {"AAA", "BBB"}

    b = compute_pit_breadth_series(days, signals, pit)
    # Day index 1 uses prior bar (index 0): both names eligible → 100%.
    assert abs(b.iloc[1] - 1.0) < 1e-9


def test_overlay_metrics_time_in_market():
    r = pd.Series([0.001] * 10, index=pd.date_range("2020-01-02", periods=10))
    exp = pd.Series([1.0, 1.0, 0.0, 0.0, 0.0] + [1.0] * 5, index=r.index)
    m = overlay_metrics(r, exp, n_trials=7)
    assert m.time_in_market == 0.7