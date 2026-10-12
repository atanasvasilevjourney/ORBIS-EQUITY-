from __future__ import annotations

import numpy as np

from pipeline.research.prop_challenge_sim import PropRules, simulate_challenge


def test_passes_small_steady_gains():
    rets = np.full(30, 0.004)  # ~0.4%/day
    out = simulate_challenge(rets, PropRules(min_trading_days=4))
    assert out.passed
    assert out.outcome == "passed"


def test_daily_breach():
    rets = np.zeros(10)
    rets[3] = -0.06
    out = simulate_challenge(rets, PropRules(max_daily_loss_pct=0.05))
    assert not out.passed
    assert out.outcome == "daily_breach"


def test_max_loss_breach():
    rets = np.full(20, -0.006)
    out = simulate_challenge(rets, PropRules(max_total_loss_pct=0.10))
    assert not out.passed
    assert out.outcome == "max_loss_breach"
