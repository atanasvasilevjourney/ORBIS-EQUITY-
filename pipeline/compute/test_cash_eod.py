import unittest
from datetime import date, datetime
from unittest.mock import patch

from pipeline.clients.cash_eod import (
    DailyBar,
    drop_in_progress,
    fetch_daily_bars,
    fetch_stooq_daily,
    fetch_yahoo_daily,
    last_closed_cash_date,
    last_trading_session_date,
    leftover_members,
    stooq_candidates,
    yahoo_ticker,
    yfinance_window,
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

    def test_last_closed_cash_date_is_yesterday_before_1600_et(self):
        now = datetime(2026, 9, 18, 15, 30, tzinfo=__import__("zoneinfo").ZoneInfo("America/New_York"))
        self.assertEqual(last_closed_cash_date(now=now), date(2026, 9, 17))
        after = datetime(2026, 9, 18, 16, 1, tzinfo=__import__("zoneinfo").ZoneInfo("America/New_York"))
        self.assertEqual(last_closed_cash_date(now=after), date(2026, 9, 18))

    def test_yfinance_end_is_exclusive_next_day(self):
        start, end = yfinance_window(today=date(2026, 9, 18), lookback_days=10)
        self.assertEqual(start, date(2026, 9, 8))
        self.assertEqual(end, date(2026, 9, 19))

    def test_weekend_cutoff_is_friday(self):
        sat = datetime(2026, 9, 19, 17, 0, tzinfo=__import__("zoneinfo").ZoneInfo("America/New_York"))
        self.assertEqual(last_trading_session_date(now=sat), date(2026, 9, 18))
        mon_pre = datetime(2026, 9, 21, 10, 0, tzinfo=__import__("zoneinfo").ZoneInfo("America/New_York"))
        self.assertEqual(last_trading_session_date(now=mon_pre), date(2026, 9, 18))

    def test_leftover_includes_stale_max_date(self):
        members = [{"symbol": "AAA"}, {"symbol": "BBB"}, {"symbol": "CCC"}]
        rows = [
            {"symbol": "AAA", "date": "2026-09-18"},
            {"symbol": "BBB", "date": "2026-09-10"},
        ]
        leftover = leftover_members(members, rows, "2026-09-18")
        self.assertEqual([m["symbol"] for m in leftover], ["BBB", "CCC"])


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
