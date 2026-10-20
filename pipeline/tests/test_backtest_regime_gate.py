from __future__ import annotations

from datetime import date

import pandas as pd

from pipeline.research import loop_strategy_research as lsr


def _panel(days, closes):
    return pd.DataFrame(
        {"open": closes, "high": closes, "low": closes, "close": closes, "volume": 1},
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


def test_regime_gate_blocks_new_holdings(monkeypatch):
    days = pd.bdate_range("2026-03-02", periods=12)
    monkeypatch.setattr(lsr, "YTD_START", date(2026, 3, 2))
    monkeypatch.setattr(lsr, "YTD_END", date(2026, 3, 17))

    spy_closes = [100 + i * 0.1 for i in range(12)]
    aaa_closes = [50 + i for i in range(12)]
    panels = {
        "SPY": _panel(days, spy_closes),
        "AAA": _panel(days, aaa_closes),
    }
    radar = {"AAA": _radar(days, green_from=0)}

    regime = pd.DataFrame(
        {"buys_allowed": [False] * len(days)},
        index=pd.DatetimeIndex(days),
    )
    monkeypatch.setattr(lsr, "regime_series", lambda _spy: regime)

    gated = lsr.backtest_top_green_weekly(panels, radar, cost_bps=0.0, require_regime=True)
    open_ = lsr.backtest_top_green_weekly(panels, radar, cost_bps=0.0, require_regime=False)

    assert gated.total_return_pct == 0.0
    assert open_.total_return_pct > gated.total_return_pct
