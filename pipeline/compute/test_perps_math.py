import math
import unittest

import numpy as np

from pipeline.compute.perps_math import (
    carver_notional,
    drawdown_scalar,
    ema,
    equal_weight_equity,
    ewmac_forecast,
    funding_blocks,
    grade_for,
    grade_ok,
    liquidation_price,
    macd,
    macd_close_action,
    peak_drawdown_current,
    rotation_regime,
    rotation_size_mult,
    scale_gross,
    side_weights,
    size_cash,
    size_perp,
    tema,
    tema_book_eligible,
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
        x = 40.0 * (1.006 ** np.arange(280))
        high = x * 1.004
        low = x * 0.996
        atr = wilder_atr(high, low, x)
        sig = tema_signal(x, high, low, atr)
        self.assertIsNotNone(sig)
        self.assertEqual(sig.side, "BUY")
        self.assertLess(sig.stop, x[-1])
        self.assertGreater(sig.take_profit, x[-1])
        self.assertTrue(grade_ok(sig.grade, "B"))
        self.assertGreaterEqual(sig.score, 65.0)
        self.assertEqual(sig.warmup, "partial")

    def test_tema_short_on_downtrend(self):
        x = np.concatenate([np.full(250, 100.0), 100.0 * (0.997 ** np.arange(1, 81))])
        high = x * 1.004
        low = x * 0.996
        atr = wilder_atr(high, low, x)
        sig = tema_signal(x, high, low, atr)
        self.assertIsNotNone(sig)
        self.assertEqual(sig.side, "SELL")
        self.assertGreater(sig.stop, x[-1])

    def test_tema_needs_220_bars(self):
        x = np.linspace(10, 20, 100)
        atr = wilder_atr(x * 1.01, x * 0.99, x)
        self.assertIsNone(tema_signal(x, x * 1.01, x * 0.99, atr))

    def test_uptrend_macd_holds(self):
        x = 40.0 * (1.006 ** np.arange(280))
        high = x * 1.004
        low = x * 0.996
        atr = wilder_atr(high, low, x)
        sig = tema_signal(x, high, low, atr)
        self.assertIsNotNone(sig)
        self.assertEqual(sig.side, "BUY")
        self.assertTrue(math.isfinite(sig.macd))
        self.assertTrue(math.isfinite(sig.macd_signal))
        self.assertGreater(sig.macd, sig.macd_signal)
        self.assertEqual(sig.macd_action, "HOLD")
        self.assertTrue(tema_book_eligible(sig))

    def test_uptrend_then_fade_macd_closes(self):
        # Two flat prints after a strong ramp: TEMA 9 still > 99 (setup holds)
        # but MACD line drops through its signal — systematic close.
        up = 40.0 * (1.006 ** np.arange(270))
        x = np.concatenate([up, np.full(2, up[-1])])
        high = x * 1.004
        low = x * 0.996
        atr = wilder_atr(high, low, x)
        sig = tema_signal(x, high, low, atr)
        self.assertIsNotNone(sig)
        self.assertEqual(sig.side, "BUY")
        self.assertTrue(grade_ok(sig.grade))
        self.assertLessEqual(sig.macd, sig.macd_signal)
        self.assertEqual(sig.macd_action, "CLOSE")
        self.assertFalse(tema_book_eligible(sig))
        self.assertFalse(tema_book_eligible(sig, skip_reason="atr_chaos"))

    def test_macd_close_keeps_carver_eligible(self):
        """MACD CLOSE only drops the TEMA book; skip_reason stays none at scan."""
        self.assertEqual(macd_close_action("BUY", 0.1, 0.2), "CLOSE")
        self.assertEqual(macd_close_action("SELL", -0.1, -0.2), "CLOSE")
        self.assertEqual(macd_close_action("BUY", 0.3, 0.1), "HOLD")
        self.assertEqual(macd_close_action("SELL", -0.3, -0.1), "HOLD")
        self.assertEqual(macd_close_action("FLAT", 1.0, -1.0), "HOLD")
        self.assertEqual(macd_close_action("BUY", float("nan"), 0.0), "HOLD")
        line, sig, hist = macd(40.0 * (1.006 ** np.arange(80)))
        self.assertEqual(line.size, 80)
        self.assertTrue(np.isfinite(line[-1]))
        self.assertAlmostEqual(hist[-1], line[-1] - sig[-1], places=9)


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
        self.assertAlmostEqual(carver_notional(10.0, 50_000, 0.25, dd_scalar=0.5), 30_000, delta=1.0)
        self.assertEqual(carver_notional(10.0, 50_000, 0.25, dd_scalar=0.0), 0.0)

    def test_drawdown_scalar_taper(self):
        self.assertEqual(drawdown_scalar(0.0), 1.0)
        self.assertEqual(drawdown_scalar(-0.10), 1.0)
        self.assertAlmostEqual(drawdown_scalar(-0.175), 0.5, places=4)
        self.assertEqual(drawdown_scalar(-0.25), 0.0)
        self.assertEqual(drawdown_scalar(-0.40), 0.0)

    def test_rotation_levels(self):
        self.assertEqual(rotation_regime(1.0, 5), "LIVE")
        self.assertEqual(rotation_regime(0.5, 5), "REDUCE")
        self.assertEqual(rotation_regime(1.0, 1), "REDUCE")
        self.assertEqual(rotation_regime(0.0, 5), "CASH")
        self.assertEqual(rotation_regime(1.0, 0), "CASH")
        self.assertEqual(rotation_size_mult("CASH"), 0.0)
        self.assertEqual(rotation_size_mult("REDUCE"), 0.5)
        self.assertEqual(rotation_size_mult("LIVE"), 1.0)

    def test_equal_weight_drawdown_recovers(self):
        down = np.linspace(100, 70, 40)
        up = np.linspace(70, 95, 40)[1:]
        eq = equal_weight_equity([np.concatenate([down, up])])
        cur, mx = peak_drawdown_current(eq)
        self.assertLess(mx, -0.2)
        self.assertGreater(cur, mx)  # recovered off the trough

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
        self.assertIsNone(sized.liq)

    def test_liq_1x_is_none(self):
        self.assertIsNone(liquidation_price(100.0, "BUY", 1.0))

    def test_tema_notional_1p5_atr_stop(self):
        # 2% of 10k at 2.5 ATR, ATR=2, price=100 → stop dist 5 → notional 4000
        n = tema_notional(10_000, 100.0, 2.0)
        self.assertAlmostEqual(n, 10_000 * 0.02 * 100 / 5.0, places=4)

    def test_funding_blocks_buy_when_positive(self):
        self.assertTrue(funding_blocks("BUY", 0.002))
        self.assertFalse(funding_blocks("BUY", 0.0005))
        self.assertFalse(funding_blocks("BUY", None))
        self.assertTrue(funding_blocks("SELL", -0.002))

    def test_cash_caps_at_allocated(self):
        sized = size_cash(1_000_000, 10_000, 50.0, "BUY")
        self.assertTrue(sized.capped)
        self.assertAlmostEqual(sized.cash, 10_000)
        self.assertAlmostEqual(sized.shares, 200.0)
        self.assertAlmostEqual(sized.notional, 10_000)

    def test_cash_shares_from_close(self):
        sized = size_cash(4_000, 10_000, 50.0, "BUY")
        self.assertFalse(sized.capped)
        self.assertAlmostEqual(sized.shares, 80.0)
        self.assertAlmostEqual(sized.cash, 4_000)

    def test_cash_short_is_negative_notional(self):
        sized = size_cash(-8_000, 10_000, 40.0, "SELL")
        self.assertAlmostEqual(sized.notional, -8_000)
        self.assertAlmostEqual(sized.shares, 200.0)

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
        self.assertTrue(grade_ok("B"))
        self.assertFalse(grade_ok("C"))
        self.assertFalse(grade_ok("B", "A"))


if __name__ == "__main__":
    unittest.main()
