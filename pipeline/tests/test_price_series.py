from pipeline.utils.price_series import effective_close, finalize_price_row, ohlcv_frame


def test_effective_close_prefers_adj():
    assert effective_close({"close": 10.0, "adj_close": 9.5}) == 9.5
    assert effective_close({"close": 10.0}) == 10.0


def test_finalize_price_row_backfills_adj():
    row = finalize_price_row({"symbol": "AAPL", "date": "2026-01-01", "close": 100.0})
    assert row["adj_close"] == 100.0


def test_ohlcv_frame_uses_adj_for_signals():
    df = ohlcv_frame([
        {"date": "2026-01-01", "open": 1, "high": 2, "low": 1, "close": 10, "adj_close": 5, "volume": 100},
        {"date": "2026-01-02", "open": 1, "high": 2, "low": 1, "close": 10, "adj_close": 6, "volume": 100},
    ])
    assert float(df.iloc[-1]["close"]) == 6.0
