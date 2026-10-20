from datetime import date

import pandas as pd

from pipeline.compute.loop_order_economics import next_session_open, order_economics


def test_order_economics_default_bps():
    econ = order_economics(100, 50.0, fill_price=50.0)
    assert econ["cost_usd"] == round(100 * 50 * 10 / 10_000, 4)
    assert econ["commission_usd"] == econ["slippage_usd"]


def test_next_session_open_picks_following_bar():
    idx = pd.to_datetime(["2026-10-10", "2026-10-13", "2026-10-14"])
    ohlcv = pd.DataFrame({"open": [1.0, 101.0, 102.0]}, index=idx)
    px, mode = next_session_open(ohlcv, date(2026, 10, 10))
    assert mode == "next_open"
    assert px == 101.0
