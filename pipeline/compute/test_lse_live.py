import unittest
from types import SimpleNamespace

from pipeline.clients.lse_live import (
    LIVE_TIMEFRAMES,
    normalize_symbol,
    tick_to_quote,
    vault_candle_bar,
)


class LseLiveTests(unittest.TestCase):
    def test_normalize_crypto_pair_stays_equity_ticker(self):
        self.assertEqual(normalize_symbol("aapl"), "AAPL")
        self.assertEqual(normalize_symbol("BRK.B"), "BRK.B")
        self.assertEqual(normalize_symbol("btc/usd"), "BTC/USD")

    def test_tick_to_quote_from_object(self):
        tick = SimpleNamespace(
            symbol="MET",
            price=97.14,
            bid=97.10,
            ask=97.18,
            volume=1000,
            timestamp="2026-09-11T15:59:00Z",
            replay=False,
        )
        q = tick_to_quote(tick)
        self.assertIsNotNone(q)
        self.assertEqual(q["symbol"], "MET")
        self.assertEqual(q["last"], 97.14)
        self.assertEqual(q["source"], "lse_ws")
        self.assertFalse(q["replay"])

    def test_tick_rejects_bad_price(self):
        self.assertIsNone(tick_to_quote({"symbol": "AAPL", "price": 0}))
        self.assertIsNone(tick_to_quote({"symbol": "AAPL", "price": None}))
        self.assertIsNone(tick_to_quote({"symbol": "", "price": 10}))

    def test_vault_candle_normalizes_ts_alias(self):
        bar = vault_candle_bar({
            "ts": "2026-09-11T14:30:00Z",
            "o": 100,
            "h": 101,
            "l": 99,
            "c": 100.5,
            "v": 12,
        })
        self.assertEqual(bar["open"], 100)
        self.assertEqual(bar["high"], 101)
        self.assertEqual(bar["low"], 99)
        self.assertEqual(bar["close"], 100.5)
        self.assertEqual(bar["time"], "2026-09-11T14:30:00Z")

    def test_five_minute_is_a_live_timeframe(self):
        self.assertIn("5m", LIVE_TIMEFRAMES)
        self.assertNotIn("1d", LIVE_TIMEFRAMES)


if __name__ == "__main__":
    unittest.main()
