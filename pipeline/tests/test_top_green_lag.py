from __future__ import annotations

from datetime import date

import pandas as pd

from pipeline.research import loop_strategy_research as lsr


def _panel(days, opens, closes):
    return pd.DataFrame(
        {"open": opens, "high": closes, "low": opens, "close": closes, "volume": 1},
        index=pd.DatetimeIndex(days),
    )


def _radar(days, green_from: int):
    n = len(days)
    return pd.DataFrame(
        {
            "state": [1 if i >= green_from else 0 for i in range(n)],
            "quality_rank": [90] * n,
            "z_mom": [1.0] * n,
            "f_ewmac": [1.0] * n,
        },
        index=pd.DatetimeIndex(days),
    )


def test_signal_day_return_is_not_earned(monkeypatch):
    days = pd.bdate_range("2026-03-02", periods=8)
    monkeypatch.setattr(lsr, "YTD_START", date(2026, 3, 2))
    monkeypatch.setattr(lsr, "YTD_END", date(2026, 3, 11))

    # The stock gaps +10% at the open of day 3 and is flat afterwards. The radar turns
    # GREEN on day 3, i.e. it only "sees" the move at the close of day 3.
    opens = [100, 100, 100, 110, 110, 110, 110, 110]
    closes = [100, 100, 100, 110, 110, 110, 110, 110]
    panels = {
        "SPY": _panel(days, [100] * 8, [100] * 8),
        "AAA": _panel(days, opens, closes),
    }
    radar = {"AAA": _radar(days, green_from=3)}

    res = lsr.backtest_top_green_weekly(panels, radar, cost_bps=0.0)
    assert abs(res.total_return_pct) < 1e-9


def test_costs_reduce_return(monkeypatch):
    days = pd.bdate_range("2026-03-02", periods=8)
    monkeypatch.setattr(lsr, "YTD_START", date(2026, 3, 2))
    monkeypatch.setattr(lsr, "YTD_END", date(2026, 3, 11))

    closes = [100, 101, 102, 103, 104, 105, 106, 107]
    panels = {
        "SPY": _panel(days, [100] * 8, [100] * 8),
        "AAA": _panel(days, closes, closes),
    }
    radar = {"AAA": _radar(days, green_from=0)}

    free = lsr.backtest_top_green_weekly(panels, radar, cost_bps=0.0)
    paid = lsr.backtest_top_green_weekly(panels, radar, cost_bps=50.0)
    assert paid.total_return_pct < free.total_return_pct
