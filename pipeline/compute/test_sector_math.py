import math
import unittest

import numpy as np

from pipeline.compute.sector_math import (
    GroupTape,
    build_group_tape,
    equal_weight_returns,
    nest_by_parent,
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


class SubsectorNestTests(unittest.TestCase):
    def test_industry_tape_carries_parent_sector(self):
        n = 80
        px = 100.0 * (1.003 ** np.arange(n))
        mkt = 100.0 * (1.001 ** np.arange(n))
        tape = build_group_tape(
            group_type="industry",
            name="Solar",
            sector_for_bucket="Energy",
            parent_sector="Energy",
            members={"FSLR": px, "ENPH": px * 1.01},
            market_rets=equal_weight_returns([mkt, px]),
            market_r4=period_return(mkt, 20),
            vol_median=0.02,
            value_ok={"FSLR": True, "ENPH": True},
        )
        self.assertIsNotNone(tape)
        assert tape is not None
        self.assertEqual(tape.parent_sector, "Energy")
        self.assertEqual(tape.group_type, "industry")
        self.assertEqual(tape.name, "Solar")

    def test_sector_tape_has_no_parent(self):
        n = 80
        px = 100.0 * (1.002 ** np.arange(n))
        tape = build_group_tape(
            group_type="sector",
            name="Energy",
            sector_for_bucket="Energy",
            parent_sector="Energy",
            members={"XOM": px},
            market_rets=equal_weight_returns([px]),
            market_r4=period_return(px, 20),
            vol_median=0.02,
            value_ok={},
        )
        self.assertIsNotNone(tape)
        assert tape is not None
        self.assertIsNone(tape.parent_sector)

    def test_nest_energy_solar_nuclear(self):
        def fake(name: str, parent: str, score: float) -> GroupTape:
            return GroupTape(
                group_type="industry", name=name, n_names=2, tickers=[],
                current_breadth=0.6, mom_breadth=0.5, value_breadth=None,
                lowvol_breadth=0.4, avg_trend=0.01, impulse=0.0,
                beta_60=1.0, rs_4w=0.01, stretch_pct=0.0, label="ACCEL",
                heatmap=[], leaders=[], score=score, bucket="cyclical",
                parent_sector=parent,
            )
        nested = nest_by_parent([
            fake("Solar", "Energy", 80),
            fake("Nuclear", "Energy", 70),
            fake("Oil & Gas", "Energy", 40),
            fake("Software", "Technology", 90),
            GroupTape(
                group_type="sector", name="Energy", n_names=6, tickers=[],
                current_breadth=0.5, mom_breadth=0.5, value_breadth=None,
                lowvol_breadth=0.5, avg_trend=0.0, impulse=0.0,
                beta_60=1.0, rs_4w=0.0, stretch_pct=0.0, label="ACCEL",
                heatmap=[], leaders=[], score=50, bucket="cyclical",
            ),
        ])
        self.assertEqual([g.name for g in nested["Energy"]], ["Solar", "Nuclear", "Oil & Gas"])
        self.assertEqual([g.name for g in nested["Technology"]], ["Software"])
        self.assertNotIn("Energy", [g.name for kids in nested.values() for g in kids if g.group_type == "sector"])


class DemoSleeveTests(unittest.TestCase):
    def test_energy_has_solar_and_nuclear(self):
        from collections import defaultdict
        from scripts.seed_demo import STOCKS

        energy = {row[3] for row in STOCKS if row[2] == "Energy"}
        self.assertTrue({"Oil & Gas", "Solar", "Nuclear", "Oilfield Services"} <= energy)
        by_sector: dict[str, set[str]] = defaultdict(set)
        for _sym, _name, sector, industry, *_rest in STOCKS:
            by_sector[sector].add(industry)
        for sector, industries in by_sector.items():
            self.assertGreaterEqual(len(industries), 2, sector)


if __name__ == "__main__":
    unittest.main()
