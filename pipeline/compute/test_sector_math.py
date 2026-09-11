import math
import unittest

import numpy as np

from pipeline.compute.sector_math import (
    build_group_tape,
    equal_weight_returns,
    ols_beta,
    period_return,
    rotation_regime,
    trend_label,
    weekly_heatmap,
)


class PeriodAndBetaTests(unittest.TestCase):
    def test_period_return(self):
        x = np.array([100.0, 101, 102, 110], dtype=float)
        self.assertAlmostEqual(period_return(x, 3), 0.10, places=6)
        self.assertTrue(math.isnan(period_return(x, 10)))

    def test_ols_beta_market_is_one(self):
        rng = np.random.default_rng(0)
        mkt = rng.normal(0.0005, 0.01, 80)
        y = mkt  # identical
        self.assertAlmostEqual(ols_beta(y, mkt), 1.0, places=6)

    def test_ols_beta_levered(self):
        rng = np.random.default_rng(1)
        mkt = rng.normal(0.0, 0.01, 80)
        y = 1.5 * mkt
        self.assertAlmostEqual(ols_beta(y, mkt), 1.5, places=5)

    def test_heatmap_eight_weeks(self):
        # 41 prints: 8 weeks of +1% each 5 bars
        px = [100.0]
        for _ in range(40):
            px.append(px[-1] * 1.01)
        heat = weekly_heatmap(np.array(px))
        self.assertEqual(len(heat), 8)
        for h in heat:
            self.assertAlmostEqual(h, 1.01 ** 5 - 1.0, places=6)


class LabelAndRegimeTests(unittest.TestCase):
    def test_labels(self):
        self.assertEqual(trend_label(0.80, 0.01), "LEAD")
        self.assertEqual(trend_label(0.80, -0.01), "FADE")
        self.assertEqual(trend_label(0.30, 0.01), "REPAIR")
        self.assertEqual(trend_label(0.55, 0.01), "ACCEL")
        self.assertEqual(trend_label(0.40, -0.01), "LAG")

    def test_uptrend_group_is_lead_high_beta(self):
        n = 120
        mkt = 100.0 * (1.002 ** np.arange(n))
        hi = 100.0 * (1.004 ** np.arange(n))  # faster
        members = {"AAA": hi, "BBB": hi * 1.01}
        mkt_rets = equal_weight_returns([mkt, hi])
        tape = build_group_tape(
            group_type="sector",
            name="Technology",
            sector_for_bucket="Technology",
            members=members,
            market_rets=mkt_rets,
            market_r4=period_return(mkt, 20),
            vol_median=0.02,
            value_ok={"AAA": True, "BBB": False},
        )
        self.assertIsNotNone(tape)
        self.assertEqual(tape.label, "LEAD")
        self.assertGreater(tape.current_breadth, 0.9)
        self.assertGreater(tape.beta_60, 0.5)
        self.assertEqual(tape.bucket, "cyclical")
        self.assertEqual(len(tape.heatmap), 8)

    def test_regime_risk_on_when_cyclicals_lead(self):
        def fake(name, bucket, rs):
            from pipeline.compute.sector_math import GroupTape
            return GroupTape(
                group_type="sector", name=name, n_names=2, tickers=[],
                current_breadth=0.8, mom_breadth=0.7, value_breadth=None,
                lowvol_breadth=0.5, avg_trend=0.02, impulse=0.0,
                beta_60=1.2, rs_4w=rs, stretch_pct=0.0, label="LEAD",
                heatmap=[], leaders=[], score=70, bucket=bucket,
            )
        tapes = [
            fake("Technology", "cyclical", 0.04),
            fake("Financials", "cyclical", 0.03),
            fake("Health Care", "defensive", -0.02),
            fake("Consumer Staples", "defensive", -0.01),
        ]
        self.assertEqual(rotation_regime(tapes), "RISK-ON")
        tapes[0] = fake("Technology", "cyclical", -0.04)
        tapes[1] = fake("Financials", "cyclical", -0.03)
        tapes[2] = fake("Health Care", "defensive", 0.03)
        tapes[3] = fake("Consumer Staples", "defensive", 0.02)
        self.assertEqual(rotation_regime(tapes), "RISK-OFF")


if __name__ == "__main__":
    unittest.main()
