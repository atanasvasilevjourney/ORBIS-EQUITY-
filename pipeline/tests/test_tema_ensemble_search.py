"""TEMA-MACD ensemble search: causal votes, grid, and the train-only sampler."""
import numpy as np
import pandas as pd

from pipeline.compute.canary_math import tema_macd_hist
from pipeline.research.tema_ensemble_search import (
    FAST_GAP,
    default_param_grid,
    ensemble_position,
    make_panel,
    neighbor_cloud,
    run_study,
    tema_macd_hist_series,
    tpe_search,
)


def test_grid_keeps_a_gap_and_fixes_signal():
    grid = default_param_grid()
    assert len(grid) > 20
    for p in grid:
        assert p["slow"] >= p["fast"] + FAST_GAP
        assert p["signal"] == 9


def test_hist_matches_scalar_helper_and_ignores_the_future():
    x = 40.0 * np.cumprod(1.0 + np.random.default_rng(1).normal(0.0005, 0.01, 360))
    series = tema_macd_hist_series(x, 12, 26, 9)
    assert np.isnan(series[: 26 + 9 + 5 - 1]).all()
    assert series[-1] == tema_macd_hist(x, 12, 26, 9)
    shocked = x.copy()
    shocked[-20:] *= 1.5
    shocked_series = tema_macd_hist_series(shocked, 12, 26, 9)
    assert np.allclose(series[:-20], shocked_series[:-20], equal_nan=True)


def test_six_vote_thresholds_differ_where_the_count_differs():
    n = 30
    hists = [np.full(n, 1.0) for _ in range(4)] + [np.full(n, -1.0) for _ in range(2)]
    # 4 of 6 long: production fires, the 5-of-6 rule does not.
    assert ensemble_position(hists, 0.55, 0.45)[-1] == 1.0
    assert ensemble_position(hists, 5 / 6, 1 / 6)[-1] == 0.0
    strict = [np.full(n, 1.0) for _ in range(5)] + [np.full(n, -1.0)]
    assert ensemble_position(strict, 5 / 6, 1 / 6)[-1] == 1.0
    tie = [np.full(n, 1.0) for _ in range(3)] + [np.full(n, -1.0) for _ in range(3)]
    assert ensemble_position(tie, 0.55, 0.45)[-1] == 0.0


def test_tpe_respects_the_gap_and_finds_the_peak():
    def objective(p):
        return -((p["fast"] - 12) ** 2 + (p["slow"] - 40) ** 2 + (p["signal"] - 9) ** 2)

    trials = tpe_search(objective, n_trials=40, n_startup=12, seed=3)
    assert len(trials) == 40
    for row in trials:
        assert row["slow"] >= row["fast"] + FAST_GAP
        assert row["signal"] in (5, 9, 12)
    assert trials[0]["train_sharpe"] >= -25


def test_neighbors_stay_inside_the_research_box():
    cloud = neighbor_cloud([{"fast": 8, "slow": 21, "signal": 9}, {"fast": 19, "slow": 90, "signal": 5}])
    keys = {(p["fast"], p["slow"], p["signal"]) for p in cloud}
    assert len(keys) == len(cloud)
    assert (8, 21, 9) in keys
    for fast, slow, signal in keys:
        assert 5 <= fast <= 20
        assert 21 <= slow <= 100
        assert slow >= fast + FAST_GAP
        assert signal in (5, 9, 12)


def test_study_on_synthetic_panel_locks_a_fold_it_did_not_fit():
    rng = np.random.default_rng(0)
    idx = pd.bdate_range("2014-01-02", periods=700)
    series = {}
    for i, name in enumerate(("AAA", "BBB")):
        rets = rng.normal(0.0004, 0.01, len(idx))
        series[name] = pd.Series(50 * np.cumprod(1 + rets), index=idx, name=name)
    panel = make_panel(series)
    grid = [
        {"fast": 8, "slow": 21, "signal": 9},
        {"fast": 12, "slow": 26, "signal": 9},
        {"fast": 9, "slow": 34, "signal": 9},
        {"fast": 15, "slow": 40, "signal": 9},
    ]
    result = run_study(panel, n_trials=6, n_startup=3, seed=1, grid=grid)
    assert result["decision"] in {"KEEP", "PROMOTE"}
    assert result["folds"]["lock"][0] > result["folds"]["valid"][1]
    assert result["official_gate"]["floor"] == 1.0
    # Locked Sharpe is reported for the precommitted books, not used as a grid column.
    assert "lock_sharpe" not in result["validation_top"][0]
    assert "lock_sharpe" in result["production_ensemble"]
