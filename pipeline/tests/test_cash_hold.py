"""Cash-hold rules: long only, eight-name minimum, caps, and rebalance."""
from datetime import date

import numpy as np
import pandas as pd

from pipeline.research.cash_hold_backtest import simulate_quarterly
from pipeline.strategies.cash_hold import (
    GROSS_CAP,
    MAX_NAME_WEIGHT,
    MIN_NAMES,
    RULES,
    is_rebalance_session,
    should_rebalance,
    signals,
    target_weights,
    weights_drifted,
)
from pipeline.strategies.registry import get, list_strategies


def _frame(n: int = 30, start: float = 100.0) -> pd.DataFrame:
    days = pd.bdate_range("2024-01-02", periods=n)
    close = start * (1.001 ** np.arange(n))
    return pd.DataFrame(
        {
            "date": [d.strftime("%Y-%m-%d") for d in days],
            "open": close,
            "high": close * 1.01,
            "low": close * 0.99,
            "close": close,
            "volume": 1_000_000,
        }
    )


def test_rules_cover_the_safety_limits():
    text = " ".join(RULES).lower()
    assert "long only" in text
    assert "eight" in text
    assert "15%" in text
    assert "leverage" in text


def test_too_few_names_is_cash():
    assert target_weights(["A", "B", "C"]) == {}
    bars = {f"N{i}": _frame() for i in range(MIN_NAMES - 1)}
    assert signals(list(bars), bars, date(2024, 2, 15)) == []


def test_weights_are_long_only_and_inside_the_caps():
    names = [f"N{i}" for i in range(MIN_NAMES)]
    weights = target_weights(names)
    assert set(weights) == set(names)
    assert all(w > 0 for w in weights.values())
    assert max(weights.values()) <= MAX_NAME_WEIGHT + 1e-12
    assert sum(weights.values()) <= GROSS_CAP + 1e-12
    bars = {name: _frame() for name in names}
    out = signals(names, bars, date(2024, 2, 15))
    assert {s.side for s in out} == {"BUY"}
    assert abs(sum(s.size_hint for s in out) - sum(weights.values())) < 1e-12


def test_registry_exposes_cash_hold():
    assert "cash_hold" in list_strategies()
    assert get("cash_hold") is signals


def test_rebalance_on_the_first_session_of_a_quarter_or_on_drift():
    assert is_rebalance_session(date(2024, 4, 1), date(2024, 3, 28))
    assert not is_rebalance_session(date(2024, 4, 2), date(2024, 4, 1))
    assert not is_rebalance_session(date(2024, 5, 1), date(2024, 4, 30))
    targets = {f"N{i}": 0.1 for i in range(10)}
    current = dict(targets)
    assert not weights_drifted(current, targets)
    current["N0"] = 0.16
    assert weights_drifted(current, targets)
    assert should_rebalance(date(2024, 5, 2), date(2024, 5, 1), current, targets)
    assert not should_rebalance(date(2024, 5, 2), date(2024, 5, 1), targets, targets)


def test_quarterly_simulation_stays_positive_on_a_rising_panel():
    idx = pd.bdate_range("2018-01-02", periods=400)
    frame = pd.DataFrame(
        {f"N{i}": 50 * (1.0004 ** np.arange(len(idx))) * (1 + 0.01 * i) for i in range(8)},
        index=idx,
    )
    nav = simulate_quarterly(frame, cost_bps=5.0)
    assert nav.iloc[-1] > 1.0
    assert nav.min() > 0.0
