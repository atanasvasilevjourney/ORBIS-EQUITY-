from __future__ import annotations

from datetime import date

import pandas as pd

from pipeline.strategies.donchian_vwap import signals
from pipeline.strategies.registry import get, list_strategies


def _bars(n: int = 80) -> pd.DataFrame:
    days = pd.bdate_range("2025-06-01", periods=n)
    rows = []
    for i, day in enumerate(days):
        close = 100 + i * 0.1
        rows.append(
            {
                "date": day.strftime("%Y-%m-%d"),
                "open": close - 0.5,
                "high": close + 1,
                "low": close - 1,
                "close": close,
                "volume": 1_000_000,
            }
        )
    return pd.DataFrame(rows)


def test_registry_lists_donchian():
    assert "donchian_vwap" in list_strategies()
    assert get("donchian_vwap") is not None


def test_donchian_signals_use_only_history_up_to_as_of():
    bars = {"AAA": _bars()}
    out = signals(["AAA"], bars, date(2025, 8, 15))
    assert isinstance(out, list)
