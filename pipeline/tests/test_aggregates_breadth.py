"""Posture must follow the day's advancers, not watchlist size."""
from pipeline.compute.aggregates import compute_breadth, compute_posture


def test_posture_is_advancer_share_not_hot_list_share():
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
    assert compute_posture(breadth) == 75
