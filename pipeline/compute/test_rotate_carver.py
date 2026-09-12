import unittest

import numpy as np

from pipeline.compute.rotate_carver import (
    NameInput,
    allocate_rungs,
    build_carver_book,
    carver_weight,
    dca_action,
    forecast_side,
    name_agrees,
    rungs_from_forecast,
    xs_score,
)


class RungTests(unittest.TestCase):
    def test_discrete_dca_rungs(self):
        self.assertEqual(rungs_from_forecast(0.0), 0)
        self.assertEqual(rungs_from_forecast(4.9), 0)
        self.assertEqual(rungs_from_forecast(5.0), 1)
        self.assertEqual(rungs_from_forecast(10.0), 2)
        self.assertEqual(rungs_from_forecast(-15.0), 3)
        self.assertEqual(rungs_from_forecast(20.0), 4)
        self.assertEqual(rungs_from_forecast(float("nan")), 0)

    def test_side(self):
        self.assertEqual(forecast_side(12.0), "LONG")
        self.assertEqual(forecast_side(-12.0), "SHORT")
        self.assertEqual(forecast_side(1.0), "FLAT")

    def test_name_must_agree_with_parent(self):
        self.assertTrue(name_agrees(8.0, 12.0))
        self.assertFalse(name_agrees(-8.0, 12.0))
        self.assertFalse(name_agrees(8.0, 2.0))


class AllocationTests(unittest.TestCase):
    def test_rungs_only_on_leading_agreeing_name(self):
        self.assertEqual(
            allocate_rungs(3, aligned=True, sleeve_rank=1, xs_rank=1, agrees=True),
            3,
        )
        self.assertEqual(
            allocate_rungs(3, aligned=True, sleeve_rank=2, xs_rank=1, agrees=True),
            0,
        )
        self.assertEqual(
            allocate_rungs(3, aligned=True, sleeve_rank=1, xs_rank=3, agrees=True),
            0,
        )
        self.assertEqual(
            allocate_rungs(3, aligned=False, sleeve_rank=1, xs_rank=1, agrees=True),
            0,
        )
        self.assertEqual(
            allocate_rungs(3, aligned=True, sleeve_rank=1, xs_rank=1, agrees=False),
            0,
        )

    def test_action_add_rotate_flat(self):
        self.assertEqual(dca_action(3, 3, 1, 1), "ADD")
        self.assertEqual(dca_action(1, 1, 1, 1), "HOLD")
        self.assertEqual(dca_action(3, 1, 1, 1), "TRIM")
        self.assertEqual(dca_action(3, 0, 2, 1), "ROTATE")
        self.assertEqual(dca_action(0, 0, 1, 1), "FLAT")

    def test_weight_scales_with_rungs_and_caps(self):
        w1 = carver_weight(1, 5.0, 0.80)
        w4 = carver_weight(4, 5.0, 0.80)
        self.assertGreater(w4, w1)
        self.assertAlmostEqual(w4, 4 * w1, places=6)
        self.assertEqual(carver_weight(0, 5.0, 0.80), 0.0)
        self.assertLessEqual(carver_weight(4, 20.0, 0.05), 0.20)


class CrossSectionTests(unittest.TestCase):
    def test_xs_score_leader_positive(self):
        n = 80
        leader = 100.0 * (1.01 ** np.arange(n))
        laggard = 100.0 * (1.001 ** np.arange(n))
        score = xs_score(leader, [leader, laggard])
        self.assertGreater(score, 0.0)

    def test_book_rotates_rungs_into_leading_sleeve(self):
        n = 220
        t = np.arange(n)
        # Strong sector uptrend (unlocks several rungs)
        sector = 100.0 * (1.006 ** t)
        # Solar outperforms Oil inside Energy
        solar_a = 100.0 * (1.010 ** t)
        solar_b = 100.0 * (1.008 ** t)
        oil_a = 100.0 * (1.002 ** t)
        oil_b = 100.0 * (1.001 ** t)
        names = [
            NameInput("FSLR", "Energy", "Solar", solar_a, True),
            NameInput("ENPH", "Energy", "Solar", solar_b, True),
            NameInput("XOM", "Energy", "Oil & Gas", oil_a, True),
            NameInput("CVX", "Energy", "Oil & Gas", oil_b, True),
        ]
        book = build_carver_book(
            names,
            sector_closes={"Energy": sector},
            sleeve_closes={"Solar": solar_a, "Oil & Gas": oil_a},
        )
        by_t = {r.ticker: r for r in book}
        self.assertGreater(by_t["FSLR"].unlocked, 0)
        self.assertEqual(by_t["FSLR"].sleeve_rank, 1)
        self.assertGreater(by_t["XOM"].sleeve_rank, 1)
        self.assertGreater(by_t["FSLR"].rungs, 0)
        self.assertEqual(by_t["XOM"].rungs, 0)
        self.assertEqual(by_t["XOM"].action, "ROTATE")
        self.assertIn(by_t["FSLR"].action, {"ADD", "HOLD"})
        self.assertGreater(by_t["FSLR"].notional, 0.0)

    def test_misaligned_sector_gets_no_rungs(self):
        n = 220
        t = np.arange(n)
        px = 100.0 * (1.006 ** t)
        names = [NameInput("FSLR", "Energy", "Solar", px, False)]
        book = build_carver_book(
            names,
            sector_closes={"Energy": px},
            sleeve_closes={"Solar": px},
        )
        self.assertEqual(book[0].unlocked, 0)
        self.assertEqual(book[0].rungs, 0)
        self.assertEqual(book[0].action, "FLAT")


if __name__ == "__main__":
    unittest.main()
