import unittest
from datetime import datetime
from unittest.mock import patch

from pipeline.clients.cash_eod import (
    DailyBar,
    drop_in_progress,
    fetch_daily_bars,
    fetch_stooq_daily,
    fetch_yahoo_daily,
    stooq_candidates,
    yahoo_ticker,
)


def _bar(d: str, close: float = 10.0, source: str = "yahoo") -> DailyBar:
    return DailyBar("AAPL", d, close, close, close, close, close, 100, source)


YAHOO_PAYLOAD = {
    "chart": {
        "result": [
            {
                "timestamp": [
                    1_704_067_200,
                    1_704_153_600,
                    1_704_240_000,
                    1_704_326_400,
                    1_704_412_800,
                ],
                "indicators": {
                    "quote": [
                        {
                            "open": [100.0, 101.0, 102.0, 103.0, 104.0],
                            "high": [101.0, 102.0, 103.0, 104.0, 105.0],
                            "low": [99.0, 100.0, 101.0, 102.0, 103.0],
                            "close": [100.5, 101.5, 102.5, 103.5, 104.5],
                            "volume": [1_000, 1_100, 1_200, 1_300, 1_400],
                        }
                    ],
                    "adjclose": [{"adjclose": [100.5, 101.5, 102.5, 103.5, 104.5]}],
                },
            }
        ]
    }
}

STOOQ_CSV = (
    "Date,Open,High,Low,Close,Volume\n"
    "2024-01-02,100,101,99,100.5,1000\n"
    "2024-01-03,101,102,100,101.5,1100\n"
    "2024-01-04,102,103,101,102.5,1200\n"
    "2024-01-05,103,104,102,103.5,1300\n"
    "2024-01-08,104,105,103,104.5,1400\n"
)


class MappingTests(unittest.TestCase):
    def test_yahoo_share_class(self):
        self.assertEqual(yahoo_ticker("brk.b"), "BRK-B")

    def test_stooq_us_and_uk(self):
        self.assertEqual(stooq_candidates("AAPL"), ["aapl.us"])
        self.assertEqual(stooq_candidates("SHEL", "GB"), ["shel.uk", "shel.us"])


class ClosedBarTests(unittest.TestCase):
    def test_drops_today_before_cash_close(self):
        bars = [_bar("2026-09-11"), _bar("2026-09-12")]
        now = datetime(2026, 9, 12, 15, 30, tzinfo=__import__("zoneinfo").ZoneInfo("America/New_York"))
        out = drop_in_progress(bars, now=now)
        self.assertEqual([b.date for b in out], ["2026-09-11"])

    def test_keeps_today_after_cash_close(self):
        bars = [_bar("2026-09-11"), _bar("2026-09-12")]
        now = datetime(2026, 9, 12, 16, 5, tzinfo=__import__("zoneinfo").ZoneInfo("America/New_York"))
        out = drop_in_progress(bars, now=now)
        self.assertEqual([b.date for b in out], ["2026-09-11", "2026-09-12"])


class _Resp:
    def __init__(self, text="", json_data=None, status=200):
        self.text = text
        self._json = json_data
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")

    def json(self):
        return self._json


class ProviderTests(unittest.TestCase):
    @patch("pipeline.clients.cash_eod.requests.get")
    def test_yahoo_parses_chart(self, get):
        get.return_value = _Resp(json_data=YAHOO_PAYLOAD)
        bars = fetch_yahoo_daily("AAPL", bars=10)
        self.assertEqual(len(bars), 5)
        self.assertEqual(bars[-1].close, 104.5)
        self.assertEqual(bars[-1].source, "yahoo")

    @patch("pipeline.clients.cash_eod.requests.get")
    def test_stooq_parses_csv(self, get):
        get.return_value = _Resp(text=STOOQ_CSV)
        bars = fetch_stooq_daily("AAPL", bars=10)
        self.assertEqual(len(bars), 5)
        self.assertEqual(bars[-1].close, 104.5)
        self.assertEqual(bars[-1].source, "stooq")

    @patch("pipeline.clients.cash_eod.requests.get")
    def test_stooq_html_then_yahoo(self, get):
        html = _Resp(text="<!DOCTYPE html><html>challenge</html>")
        yahoo = _Resp(json_data=YAHOO_PAYLOAD)

        def side_effect(url, *args, **kwargs):
            if "yahoo" in url:
                return yahoo
            return html

        get.side_effect = side_effect
        bars, src = fetch_daily_bars("AAPL", bars=10, now=datetime(2026, 9, 12, 18, 0))
        self.assertEqual(src, "yahoo")
        self.assertGreaterEqual(len(bars), 5)


if __name__ == "__main__":
    unittest.main()
