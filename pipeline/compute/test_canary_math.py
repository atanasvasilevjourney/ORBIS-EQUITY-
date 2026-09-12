import unittest

import numpy as np

from pipeline.compute.canary_math import (
    build_canaries,
    equity_from_closes,
    group_aligned,
    rolling_z,
    score_regime,
    tema_ensemble,
    tema_macd_hist,
    vote_from_smooth,
    CanaryVote,
)


class CanaryVoteTests(unittest.TestCase):
    def test_vote_band(self):
        self.assertEqual(vote_from_smooth(0.4), 1)
        self.assertEqual(vote_from_smooth(-0.4), -1)
        self.assertEqual(vote_from_smooth(0.1), 0)
        self.assertEqual(vote_from_smooth(0.4, invert=True), -1)

    def test_rolling_z_late_print_positive_on_ramp(self):
        x = np.concatenate([np.ones(140), np.linspace(1.0, 1.4, 20)])
        z = rolling_z(x, window=126)
        self.assertGreater(z[-1], 1.0)

    def test_regime_aggregation(self):
        def v(vote):
            return CanaryVote("x", "x", 0.0, 0.0, vote, "", True)
        self.assertEqual(score_regime([v(1), v(1), v(1), v(0)]).regime, "STRONG RISK-ON")
        self.assertEqual(score_regime([v(1), v(0), v(0)]).regime, "RISK-ON")
        self.assertEqual(score_regime([v(-1), v(-1), v(-1)]).regime, "STRONG RISK-OFF")
        self.assertEqual(score_regime([v(1), v(-1)]).regime, "NEUTRAL")

    def test_tech_lead_is_risk_on(self):
        n = 260
        univ = 100 * (1.001 ** np.arange(n))
        tech = 100 * (1.004 ** np.arange(n))
        staples = 100 * (1.0005 ** np.arange(n))
        disc = 100 * (1.003 ** np.arange(n))
        energy = 100 * (1.002 ** np.arange(n))
        defensive = staples
        financials = 100 * (1.002 ** np.arange(n))
        reg = build_canaries({
            "univ": univ, "tech": tech, "disc": disc, "staples": staples,
            "energy": energy, "defensive": defensive, "financials": financials,
        })
        self.assertIn(reg.regime, {"RISK-ON", "STRONG RISK-ON"})
        qqq = next(v for v in reg.votes if v.name == "QQQ/SPY")
        self.assertEqual(qqq.vote, 1)


class TemaEnsembleTests(unittest.TestCase):
    def test_uptrend_hist_positive(self):
        x = 40.0 * (1.006 ** np.arange(180))
        h = tema_macd_hist(x, 12, 26, 9)
        self.assertGreater(h, 0)

    def test_uptrend_ensemble_long(self):
        x = 40.0 * (1.006 ** np.arange(220))
        high = x * 1.004
        low = x * 0.996
        ens = tema_ensemble(x, high, low)
        self.assertGreaterEqual(ens.ensemble, 0.55)
        self.assertEqual(ens.triggered, "LONG")
        self.assertEqual(ens.tema_side, "BUY")

    def test_alignment(self):
        self.assertTrue(group_aligned("cyclical", "LEAD", "RISK-ON"))
        self.assertFalse(group_aligned("defensive", "LEAD", "RISK-ON"))
        self.assertTrue(group_aligned("defensive", "LEAD", "RISK-OFF"))
        self.assertTrue(group_aligned("cyclical", "LEAD", "NEUTRAL"))


class EquityTests(unittest.TestCase):
    def test_equity_compounds(self):
        a = np.array([100.0, 110, 121])
        eq = equity_from_closes([a])
        self.assertAlmostEqual(eq[-1], 1.21, places=6)


if __name__ == "__main__":
    unittest.main()
