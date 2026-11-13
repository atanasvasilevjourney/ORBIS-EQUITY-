from pipeline.compute.sync_loop_journal import _journal_id, closed_trades_to_journal_rows
from pipeline.research.loop_log_report import closed_trades


def test_closed_trades_to_journal_rows_stable_id():
    orders = [
        {
            "id": "buy-1",
            "ticker": "MSFT",
            "action": "BUY",
            "shares": 5,
            "limit_price": 400.0,
            "reason": "DC55",
            "sector": "Tech",
            "created_at": "2026-02-01T12:00:00+00:00",
        },
        {
            "id": "sell-1",
            "ticker": "MSFT",
            "action": "SELL",
            "shares": 5,
            "limit_price": 420.0,
            "reason": "ATR trail",
            "sector": "Tech",
            "created_at": "2026-02-10T12:00:00+00:00",
        },
    ]
    df = closed_trades(orders)
    rows = closed_trades_to_journal_rows(df)
    assert len(rows) == 1
    assert rows[0]["symbol"] == "MSFT"
    assert rows[0]["pnl_usd"] == 100.0
    assert rows[0]["id"] == _journal_id(df.iloc[0].to_dict())
    assert rows[0]["desk"] == "loop"


def test_closed_trades_use_fill_and_round_trip_cost():
    orders = [
        {
            "id": "buy-1",
            "ticker": "MSFT",
            "action": "BUY",
            "shares": 10,
            "limit_price": 100.0,
            "fill_price": 101.0,
            "cost_usd": 5.0,
            "created_at": "2026-02-01T12:00:00+00:00",
        },
        {
            "id": "sell-1",
            "ticker": "MSFT",
            "action": "SELL",
            "shares": 4,
            "limit_price": 110.0,
            "fill_price": 109.0,
            "cost_usd": 4.0,
            "created_at": "2026-02-10T12:00:00+00:00",
        },
    ]
    df = closed_trades(orders)
    assert len(df) == 1
    # Gross (109 - 101) * 4 = 32. Entry cost 5 * 4/10 = 2. Exit cost 4.
    assert df.iloc[0]["entry"] == 101.0
    assert df.iloc[0]["exit"] == 109.0
    assert df.iloc[0]["pnl_usd"] == 26.0
