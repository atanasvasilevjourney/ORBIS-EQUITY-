"""Unit tests for Turtle System 1 Donchian research engine."""
from datetime import date

import numpy as np
import pandas as pd

from pipeline.research.turtle_s1_backtest import (
    TurtleS1Config,
    cap_unit_weight,
    next_pyramid_add_price,
    precompute_features,
    prior_donchian_high,
    prior_donchian_low,
    run_turtle_s1,
    should_skip_entry,
    turtle_unit_shares,
)


def test_donchian_channels_exclude_current_bar():
    high = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 20.0])
    low = pd.Series([0.5] * len(high))
    low.iloc[-1] = 0.01
    upper = prior_donchian_high(high, window=10)
    lower = prior_donchian_low(low, window=10)
    # Last bar high=20 is excluded from its own 10-day channel (prior max is 11)
    assert upper.iloc[-1] == 11.0
    # Last bar low is excluded from its own 10-day min
    assert lower.iloc[-1] == 0.5


def test_skip_if_last_winner_rule():
    assert should_skip_entry(True, True) is True
    assert should_skip_entry(False, True) is False
    assert should_skip_entry(None, True) is False
    assert should_skip_entry(True, False) is False


def test_n_based_sizing_and_pyramid_level():
    equity = 100_000.0
    n = 2.0
    shares = turtle_unit_shares(equity, n)
    assert abs(shares - 500.0) < 1e-6
    w = cap_unit_weight(shares, 50.0, equity)
    assert abs(w - 0.10) < 1e-6  # capped at 10% of equity
    assert next_pyramid_add_price(100.0, 4.0) == 102.0


def test_turtle_smoke_run():
    idx = pd.bdate_range("2023-01-03", periods=80)
    rng = np.random.default_rng(1)
    panels: dict[str, pd.DataFrame] = {}
    for i, sym in enumerate(["AAA", "BBB", "SPY"]):
        rets = rng.normal(0.002 if sym != "SPY" else 0.0003, 0.015, len(idx))
        close = (20 + i) * np.cumprod(1 + rets)
        panels[sym] = pd.DataFrame(
            {
                "open": close * 0.995,
                "high": close * 1.02,
                "low": close * 0.98,
                "close": close,
                "volume": np.full(len(idx), 1_000_000),
            },
            index=idx,
        )
    features = {k: precompute_features(v) for k, v in panels.items() if k != "SPY"}
    lookup = lambda d: {"AAA", "BBB"}  # noqa: ARG005
    cfg = TurtleS1Config("smoke")
    daily, stats = run_turtle_s1(
        date(2023, 2, 1),
        date(2023, 5, 1),
        config=cfg,
        panels=panels,
        membership_lookup=lookup,
        features=features,
    )
    assert len(daily) > 5
    assert "trade_count" in stats