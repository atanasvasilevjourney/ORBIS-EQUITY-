"""Rules for the long-only TEMA-MACD book. No network."""
import numpy as np

from pipeline.research.tema_ensemble_backtest import select_weights, sticky_long


def test_histogram_dip_does_not_exit_a_long_the_slow_line_still_holds():
    regime_up = np.array([False] * 5 + [True] * 10 + [False] * 5)
    votes = np.array([0] * 5 + [3] * 3 + [0] * 7 + [3] * 5, dtype=float)
    pos = sticky_long(regime_up, votes, start=5)
    assert pos[5] == 1.0
    assert pos[8] == 1.0
    assert pos[14] == 1.0
    assert pos[15] == 0.0
    assert pos[:5].sum() == 0.0


def test_a_down_regime_never_opens_a_short():
    regime_up = np.zeros(12, dtype=bool)
    votes = np.full(12, 3.0)
    pos = sticky_long(regime_up, votes, start=2)
    assert pos.sum() == 0.0


def test_sector_cap_keeps_a_third_name_from_the_same_sector():
    active = np.ones((4, 1), dtype=bool)
    score = np.array([[4.0], [3.0], [2.0], [1.0]])
    sectors = ["Tech", "Tech", "Tech", "Health"]
    weights = select_weights(active, score, sectors, top_n=3, sector_cap=2)
    assert list(weights[:, 0] > 0) == [True, True, False, True]
    assert weights[:, 0].sum() == 1.0


def test_empty_day_stays_in_cash():
    active = np.zeros((3, 2), dtype=bool)
    score = np.zeros((3, 2))
    weights = select_weights(active, score, ["A", "B", "C"])
    assert weights.sum() == 0.0
