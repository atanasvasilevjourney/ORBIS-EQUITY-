import unittest

from pipeline.compute.aggregates import compute_breadth, compute_posture


class BreadthTests(unittest.TestCase):
    def test_financials_beats_all_grey_real_estate(self):
        uni = [
            {"symbol": "JPM", "sector": "Financials"},
            {"symbol": "V", "sector": "Financials"},
            {"symbol": "EQIX", "sector": "Real Estate"},
            {"symbol": "AMT", "sector": "Real Estate"},
            {"symbol": "NFLX", "sector": "Communication Services"},
            {"symbol": "META", "sector": "Communication Services"},
        ]
        radar = [
            {"symbol": "JPM", "state": 1},
            {"symbol": "V", "state": 1},
            {"symbol": "EQIX", "state": 0},
            {"symbol": "AMT", "state": 0},
            {"symbol": "NFLX", "state": -1},
            {"symbol": "META", "state": -1},
        ]
        b = compute_breadth(radar, uni)
        self.assertEqual(b["best_sector"], "Financials")
        self.assertEqual(b["best_sector_score"], 100.0)
        self.assertEqual(b["sector_breadth"]["Real Estate"], 0.0)
        self.assertEqual(b["worst_sector"], "Communication Services")
        self.assertEqual(b["worst_sector_score"], -100.0)

    def test_pct_green_one_decimal(self):
        uni = [{"symbol": str(i), "sector": "X"} for i in range(30)]
        radar = [{"symbol": str(i), "state": 1 if i < 13 else -1} for i in range(30)]
        b = compute_breadth(radar, uni)
        self.assertEqual(b["pct_green"], 43.3)
        self.assertEqual(b["total"], 30)

    def test_posture_neutral_band(self):
        uni = [{"symbol": "A", "sector": "X"}, {"symbol": "B", "sector": "X"}]
        radar = [{"symbol": "A", "state": 1}, {"symbol": "B", "state": -1}]
        b = compute_breadth(radar, uni)
        score = compute_posture(b)
        self.assertGreaterEqual(score, 40)
        self.assertLess(score, 60)


if __name__ == "__main__":
    unittest.main()
