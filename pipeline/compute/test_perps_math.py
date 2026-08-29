import unittest

import numpy as np

from pipeline.compute.perps_math import (
    carver_notional,
    ema,
    ewmac_forecast,
    funding_blocks,
    grade_for,
    grade_ok,
    liquidation_price,
    scale_gross,
    side_weights,
    size_perp,
    tema,
    tema_notional,
    tema_signal,
    wilder_atr,
)


class EmaTemaTests(unittest.TestCase):
    def test_ema_flat(self):
        x = np.ones(20) * 10.0
        out = ema(x, 8)
        np.testing.assert_allclose(out, 10.0, atol=1e-9)

    def test_tema_lags_less_than_ema_on_ramp(self):
        x = np.linspace(1.0, 50.0, 80)
        e = ema(x, 21)[-1]
        t = tema(x, 21)[-1]
        # TEMA should sit closer to the last print than a single EMA.
        self.assertLess(abs(t - x[-1]), abs(e - x[-1]))

    def test_tema_long_stack_on_uptrend(self):
        x = 40.0 * (1.012 ** np.arange(220))
        high = x * 1.004
        low = x * 0.996
        atr = wilder_atr(high, low, x)
        sig = tema_signal(x, high, low, atr)
        self.assertIsNotNone(sig)
        self.assertEqual(sig.side, "BUY")
        self.assertLess(sig.stop, x[-1])
        self.assertGreater(sig.take_profit, x[-1])

    def test_tema_short_stack_on_downtrend(self):
        x = 200.0 * (0.988 ** np.arange(220))
        high = x * 1.004
        low = x * 0.996
        atr = wilder_atr(high, low, x)
        sig = tema_signal(x, high, low, atr)
        self.assertIsNotNone(sig)
        self.assertEqual(sig.side, "SELL")
        self.assertGreater(sig.stop, x[-1])


class CarverTests(unittest.TestCase):
    def test_forecast_clipped(self):
        x = np.linspace(10, 400, 250)
        f = ewmac_forecast(x, 16, 64, 3.75)
        self.assertLessEqual(abs(f), 20.0)
        self.assertGreater(f, 0)

    def test_downtrend_negative_forecast(self):
        x = np.linspace(400, 10, 250)
        f = ewmac_forecast(x, 16, 64, 3.75)
        self.assertLess(f, 0)

    def test_carver_notional_zero_below_min_abs(self):
        self.assertEqual(carver_notional(4.9, 50_000, 0.3), 0.0)
        n = carver_notional(10.0, 50_000, 0.25)
        # forecast 10, IDM 1.2, tau=vol → weight 1.2 × 50k
        self.assertAlmostEqual(n, 50_000 * 1.2, delta=1.0)

    def test_scale_gross_caps(self):
        out = scale_gross([100_000, -100_000], 50_000, 3.0)
        self.assertAlmostEqual(sum(abs(x) for x in out), 150_000, places=4)


class PerpOverlayTests(unittest.TestCase):
    def test_liq_long_below_entry(self):
        liq = liquidation_price(100.0, "BUY", 5.0)
        self.assertLess(liq, 100.0)
        self.assertGreater(liq, 70.0)

    def test_liq_short_above_entry(self):
        liq = liquidation_price(100.0, "SELL", 5.0)
        self.assertGreater(liq, 100.0)

    def test_size_caps_at_max_lev(self):
        sized = size_perp(1_000_000, 10_000, 50.0, "BUY", max_lev=5.0)
        self.assertTrue(sized.capped)
        self.assertAlmostEqual(sized.leverage, 5.0)
        self.assertAlmostEqual(abs(sized.notional), 50_000)

    def test_sub_1x_is_fully_funded(self):
        sized = size_perp(4_000, 10_000, 50.0, "BUY")
        self.assertEqual(sized.leverage, 1.0)
        self.assertAlmostEqual(sized.margin, 4_000)

    def test_tema_notional_1p5_atr_stop(self):
        # 2% of 10k at 1.5 ATR, ATR=2, price=100 → stop dist 3 → notional 6666.67
        n = tema_notional(10_000, 100.0, 2.0)
        self.assertAlmostEqual(n, 10_000 * 0.02 * 100 / 3.0, places=4)

    def test_funding_blocks_buy_when_positive(self):
        self.assertTrue(funding_blocks("BUY", 0.002))
        self.assertFalse(funding_blocks("BUY", 0.0005))
        self.assertFalse(funding_blocks("BUY", None))
        self.assertTrue(funding_blocks("SELL", -0.002))

    def test_side_weights_sum(self):
        w = side_weights(3, 50.0)
        self.assertAlmostEqual(sum(w), 50.0, places=6)
        self.assertGreater(w[0], w[1])
        self.assertGreater(w[1], w[2])

    def test_grade_thresholds(self):
        self.assertEqual(grade_for(91, "BUY"), "A+")
        self.assertEqual(grade_for(80, "SELL"), "A")
        self.assertEqual(grade_for(50, "FLAT"), "REJECT")
        self.assertTrue(grade_ok("A"))
        self.assertFalse(grade_ok("B"))


if __name__ == "__main__":
    unittest.main()
