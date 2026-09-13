import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from pipeline.utils.cash_session import (
    last_closed_session,
    lse_is_streaming,
    session_state,
)

NY = ZoneInfo("America/New_York")


class CashSessionTests(unittest.TestCase):
    def test_sunday_is_weekend_and_last_close_is_friday(self):
        now = datetime(2026, 9, 13, 10, 0, tzinfo=NY)
        self.assertEqual(session_state(now), "CLOSED_WEEKEND")
        self.assertEqual(last_closed_session(now).isoformat(), "2026-09-11")

    def test_friday_rth_last_close_is_thursday(self):
        now = datetime(2026, 9, 11, 15, 30, tzinfo=NY)
        self.assertEqual(session_state(now), "RTH")
        self.assertEqual(last_closed_session(now).isoformat(), "2026-09-10")

    def test_friday_after_close_is_that_friday(self):
        now = datetime(2026, 9, 11, 16, 5, tzinfo=NY)
        self.assertEqual(session_state(now), "CLOSED_EOD")
        self.assertEqual(last_closed_session(now).isoformat(), "2026-09-11")

    def test_monday_premarket_last_close_is_friday(self):
        now = datetime(2026, 9, 14, 8, 0, tzinfo=NY)
        self.assertEqual(session_state(now), "PRE")
        self.assertEqual(last_closed_session(now).isoformat(), "2026-09-11")

    def test_lse_is_not_a_stream(self):
        self.assertFalse(lse_is_streaming())


if __name__ == "__main__":
    unittest.main()
