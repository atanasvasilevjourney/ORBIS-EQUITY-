from __future__ import annotations

from datetime import date

import pandas as pd

from pipeline.strategies.costs import CostModel
from pipeline.strategies.execution import equal_weight_portfolio_return, turnover_cost_fraction


def _panel() -> pd.DataFrame:
    days = pd.bdate_range("2026-03-02", periods=4)
    return pd.DataFrame(
        {
            "open": [100, 101, 102, 103],
            "high": [101, 102, 103, 104],
            "low": [99, 100, 101, 102],
            "close": [100, 101, 102, 103],
            "volume": [1, 1, 1, 1],
        },
        index=days,
    )


def test_turnover_cost_positive_on_rotation():
    c = turnover_cost_fraction(["A"], ["B"], CostModel(commission_bps=5, slippage_bps=5))
    assert c > 0


def test_new_name_uses_open_to_close():
    days = pd.bdate_range("2026-03-02", periods=3)
    panels = {
        "AAA": pd.DataFrame(
            {
                "open": [100, 100, 100],
                "high": [101, 101, 111],
                "low": [99, 99, 99],
                "close": [100, 100, 110],
                "volume": [1, 1, 1],
            },
            index=days,
        )
    }
    d = days[2].date()
    r = equal_weight_portfolio_return(
        panels, d, ["AAA"], prev_holdings=[], cost=None
    )
    assert abs(r - 0.1) < 1e-9
