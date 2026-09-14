import unittest
from datetime import date, datetime, timedelta, timezone

from pipeline.compute.quantropy import _align_returns, _as_iso_date


def _series(start: date, n: int, px0: float = 100.0) -> list[tuple[object, float]]:
    out = []
    for i in range(n):
        out.append((start + timedelta(days=i), px0 + i * 0.1))
    return out


class IsoDateTests(unittest.TestCase):
    def test_date_datetime_and_string(self):
        self.assertEqual(_as_iso_date(date(2026, 9, 14)), "2026-09-14")
        self.assertEqual(
            _as_iso_date(datetime(2026, 9, 14, 16, 0, tzinfo=timezone.utc)),
            "2026-09-14",
        )
        self.assertEqual(_as_iso_date("2026-09-14T00:00:00+00:00"), "2026-09-14")
        self.assertIsNone(_as_iso_date(None))


class AlignReturnsTests(unittest.TestCase):
    def test_two_overlapping_books(self):
        start = date(2024, 1, 1)
        by_sym = {
            "AAA": _series(start, 90, 10),
            "BBB": _series(start, 90, 20),
        }
        symbols, rets = _align_returns(by_sym, min_obs=60, max_names=40)
        self.assertEqual(symbols, ["AAA", "BBB"])
        self.assertGreaterEqual(rets.shape[0], 60)
        self.assertEqual(rets.shape[1], 2)

    def test_longer_disjoint_name_does_not_steal_the_book(self):
        nyse = date(2024, 1, 1)
        lse = date(2026, 1, 1)
        by_sym = {
            "AAA": _series(nyse, 90, 10),
            "BBB": _series(nyse, 90, 20),
            "CCC": _series(lse, 200, 30),
        }
        symbols, rets = _align_returns(by_sym, min_obs=60, max_names=40)
        self.assertEqual(set(symbols), {"AAA", "BBB"})
        self.assertNotIn("CCC", symbols)
        self.assertGreaterEqual(rets.shape[0], 60)

    def test_short_history_is_skipped(self):
        start = date(2024, 1, 1)
        by_sym = {
            "AAA": _series(start, 90),
            "BBB": _series(start, 90, 20),
            "THIN": _series(start, 10, 5),
        }
        symbols, _ = _align_returns(by_sym, min_obs=60, max_names=40)
        self.assertNotIn("THIN", symbols)

    def test_string_dates_align_with_date_objects(self):
        start = date(2024, 1, 1)
        a = _series(start, 80)
        b = [(d.isoformat() + "T00:00:00+00:00", px) for d, px in _series(start, 80, 50)]
        symbols, rets = _align_returns({"AAA": a, "BBB": b}, min_obs=60, max_names=40)
        self.assertEqual(set(symbols), {"AAA", "BBB"})
        self.assertGreaterEqual(rets.shape[0], 60)


if __name__ == "__main__":
    unittest.main()
