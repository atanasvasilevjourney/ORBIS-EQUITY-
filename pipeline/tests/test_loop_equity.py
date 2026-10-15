"""LOOP mark-to-market equity from order replay."""

from pipeline.compute.loop_equity import loop_portfolio_equity, loop_realized_pnl


def test_realized_after_round_trip():
    orders = [
        {
            "ticker": "A",
            "action": "BUY",
            "shares": 100,
            "limit_price": 100.0,
            "created_at": "2026-09-01",
        },
        {
            "ticker": "A",
            "action": "SELL",
            "shares": 100,
            "limit_price": 110.0,
            "created_at": "2026-10-01",
        },
    ]
    assert loop_realized_pnl(orders) == 1000.0
    snap = loop_portfolio_equity(orders, [])
    assert snap["mtm_equity_usd"] == 101_000.0
    assert snap["total_pnl_usd"] == 1000.0


def test_open_position_mtm():
    orders = [
        {
            "ticker": "A",
            "action": "BUY",
            "shares": 193,
            "limit_price": 171.98,
            "created_at": "2026-09-28",
        },
    ]
    book = [{"shares": 193, "entry": 171.98, "last": 174.0}]
    snap = loop_portfolio_equity(orders, book)
    assert snap["mtm_equity_usd"] == round(100_000 + 193 * (174 - 171.98), 2)
