from __future__ import annotations

from datetime import date

import pandas as pd

from pipeline.strategies.watchlist_momentum import signals


def test_watchlist_emits_buy_on_list():
    days = pd.bdate_range("2025-01-02", periods=60)
    close = [100.0] * 59 + [110.0]
    vol = [1_000_000.0] * 59 + [5_000_000.0]
    high = [c + 0.5 for c in close]
    df = pd.DataFrame(
        {
            "date": days.strftime("%Y-%m-%d"),
            "open": close,
            "high": high,
            "low": close,
            "close": close,
            "volume": vol,
        }
    )
    out = signals(["AAA"], {"AAA": df}, date(2025, 3, 28))
    assert any(s.symbol == "AAA" and s.side == "BUY" for s in out)
