import numpy as np
import pandas as pd

from pipeline.compute.rs_lookback import evaluate_rs_lookbacks, lookback_grid, production_params, score_panel


def _panel(rows: int = 160) -> tuple[pd.DataFrame, dict[str, str]]:
    idx = pd.bdate_range("2019-01-02", periods=rows)
    rng = np.random.default_rng(7)
    data = {}
    for sym, drift in (("TECH1", 0.0004), ("TECH2", 0.0003), ("EN1", 0.0012), ("EN2", 0.0001)):
        shock = drift + rng.normal(0, 0.01, rows)
        data[sym] = 100.0 * np.cumprod(1.0 + shock)
    sectors = {"TECH1": "Tech", "TECH2": "Tech", "EN1": "Energy", "EN2": "Energy"}
    return pd.DataFrame(data, index=idx), sectors


def test_score_panel_prefers_the_sector_leader():
    idx = pd.bdate_range("2024-01-02", periods=70)
    closes = pd.DataFrame(
        {
            "TECH1": np.linspace(100, 180, len(idx)),
            "TECH2": np.linspace(100, 170, len(idx)),
            "EN1": np.linspace(100, 140, len(idx)),
            "EN2": np.linspace(100, 110, len(idx)),
        },
        index=idx,
    )
    sectors = {"TECH1": "Tech", "TECH2": "Tech", "EN1": "Energy", "EN2": "Energy"}
    scores = score_panel(closes, sectors, lookback=63, skip_recent=0)
    assert scores["EN1"] > scores["TECH1"]


def test_lookback_grid_keeps_production_and_scores_without_promoting_noise():
    closes, sectors = _panel()
    assert production_params() in lookback_grid()
    selection = evaluate_rs_lookbacks(closes, sectors, top_n=2)
    assert selection.n_trials == 6
    assert selection.best is None or selection.best.params in lookback_grid()
