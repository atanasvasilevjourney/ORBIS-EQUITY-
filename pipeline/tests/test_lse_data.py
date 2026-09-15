"""Unit tests for LSE candle/tick mapping (no network)."""
from __future__ import annotations

from pipeline.clients.lse_data import candle_to_price_row
from pipeline.stream.live_quotes import tick_to_row


def test_candle_to_price_row_maps_timestamp():
    row = candle_to_price_row(
        {
            "symbol": "aapl",
            "open": 1.0,
            "high": 2.0,
            "low": 0.5,
            "close": 1.5,
            "volume": 100,
            "timestamp": "2026-09-11T00:00:00.000000Z",
        }
    )
    assert row is not None
    assert row["symbol"] == "AAPL"
    assert row["date"] == "2026-09-11"
    assert row["close"] == 1.5
    assert row["source"] == "lse"
    assert row["volume"] == 100


def test_candle_to_price_row_rejects_incomplete():
    assert candle_to_price_row({"symbol": "AAPL", "close": 1}) is None
    assert candle_to_price_row({"timestamp": "2026-01-01", "close": 1}) is None


class _Tick:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


def test_tick_to_row():
    row = tick_to_row(_Tick(symbol="msft", price=400.5, bid=400.0, ask=401.0, volume=10, timestamp="2026-09-12T15:00:00Z"))
    assert row is not None
    assert row["symbol"] == "MSFT"
    assert row["price"] == 400.5
    assert row["source"] == "lse_live"


def test_tick_to_row_dict():
    row = tick_to_row({"symbol": "X", "price": "12.3"})
    assert row is not None
    assert row["price"] == 12.3
