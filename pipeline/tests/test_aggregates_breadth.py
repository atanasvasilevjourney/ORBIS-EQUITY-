"""Breadth metrics from trend_radar rows."""
from pipeline.compute.aggregates import compute_breadth
from pipeline.compute.posture_composite import breadth_pillar


def test_breadth_advancers_and_watchlist_separate():
    rows = [
        {"symbol": "A", "state": 1, "z_mom": 6.0},
        {"symbol": "B", "state": 0, "z_mom": 1.0},
        {"symbol": "C", "state": -1, "z_mom": -1.0},
        {"symbol": "D", "state": 0, "z_mom": 0.5},
    ]
    universe = [{"symbol": s, "sector": "Tech"} for s in "ABCD"]
    breadth = compute_breadth(rows, universe)
    assert breadth["greens"] == 1
    assert breadth["advancers_pct"] == 75.0
    assert breadth_pillar(breadth["advancers_pct"], breadth["advancers_pct"]) == 75