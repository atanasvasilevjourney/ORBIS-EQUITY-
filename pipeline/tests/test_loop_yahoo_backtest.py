from __future__ import annotations

from datetime import date

import pandas as pd

from pipeline.research.loop_yahoo_backtest import run_equal_weight_book, run_xs_book


def _panel(closes: list[float]) -> pd.DataFrame:
    days = pd.bdate_range("2026-01-02", periods=len(closes))
    return pd.DataFrame(
        {
            "open": closes,
            "high": [c * 1.01 for c in closes],
            "low": closes,
            "close": closes,
            "volume": 1_000_000,
        },
        index=days,
    )


def test_xs_runs_on_tiny_panels():
    n = 120
    spy = _panel([400.0] * n)
    panels = {
        "SPY": spy,
        "AAA": _panel([100 + i * 0.4 for i in range(n)]),
        "BBB": _panel([100 + i * 0.1 for i in range(n)]),
        "CCC": _panel([50 + i * 0.3 for i in range(n)]),
        "DDD": _panel([50 + i * 0.05 for i in range(n)]),
    }
    sym = {"AAA": "Tech", "BBB": "Tech", "CCC": "Health", "DDD": "Health"}
    book = run_xs_book(panels, sym, date(2026, 2, 1), date(2026, 7, 1))
    assert len(book.daily) > 0


def test_equal_weight_averages_two_names():
    spy = _panel([100.0] * 5)
    panels = {
        "SPY": spy,
        "UP": _panel([100, 110, 121, 133.1, 146.41]),
        "DN": _panel([100, 90, 81, 72.9, 65.61]),
    }
    book = run_equal_weight_book(panels, date(2026, 1, 2), date(2026, 1, 9))
    assert len(book.daily) >= 1
