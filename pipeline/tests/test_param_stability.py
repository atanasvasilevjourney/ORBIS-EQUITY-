"""Unit tests for KAMA-DF parameter stability scoring."""
import numpy as np
import pytest

from pipeline.compute.param_stability import (
    annualized_sharpe,
    evaluate_param_grid,
    nearest_neighbor_indices,
    normalize_param_matrix,
    pairwise_euclidean,
    score_candidates,
)


class TestNormalizeAndDistance:
    def test_normalize_bounds(self):
        rows = np.array([[1.0, 10.0], [3.0, 30.0], [5.0, 50.0]])
        norm = normalize_param_matrix(rows)
        assert norm.min() == pytest.approx(0.0)
        assert norm.max() == pytest.approx(1.0)

    def test_pairwise_self_zero(self):
        rows = np.array([[0.0, 0.0], [1.0, 1.0], [0.5, 0.5]])
        dist = pairwise_euclidean(normalize_param_matrix(rows))
        assert dist[0, 0] == pytest.approx(0.0)
        assert dist[1, 0] == dist[0, 1]


class TestNeighbors:
    def test_excludes_self(self):
        dist = np.array(
            [
                [0.0, 1.0, 2.0],
                [1.0, 0.0, 1.5],
                [2.0, 1.5, 0.0],
            ]
        )
        neigh = nearest_neighbor_indices(dist, 0, n_neighbors=2)
        assert 0 not in neigh
        assert list(neigh) == [1, 2]


class TestAnnualizedSharpe:
    def test_zero_vol_returns_zero(self):
        assert annualized_sharpe(np.zeros(50)) == 0.0

    def test_positive_trend(self):
        rng = np.random.default_rng(0)
        rets = rng.normal(0.002, 0.01, 252)
        assert annualized_sharpe(rets) > 0


class TestScoreCandidates:
    def test_picks_lowest_neighbor_oos_std(self):
        # Three nearby param sets with high IS; middle has flattest OOS neighbors
        params = [
            {"n_short": 8, "n_long": 30},
            {"n_short": 10, "n_long": 30},
            {"n_short": 12, "n_long": 30},
            {"n_short": 40, "n_long": 100},  # distant, high IS, wild OOS
        ]
        is_sharpes = [1.2, 1.5, 1.3, 2.0]
        oos_sharpes = [0.9, 1.0, 0.95, -0.5]

        result = score_candidates(
            params, is_sharpes, oos_sharpes, is_sharpe_floor=1.0, n_neighbors=2
        )
        assert result.best is not None
        assert result.best.params["n_short"] in (8, 10, 12)
        assert result.best.is_sharpe > 1.0

    def test_no_qualified_returns_none(self):
        params = [{"a": 1.0}, {"a": 2.0}]
        result = score_candidates(params, [0.2, 0.3], [0.1, 0.2], is_sharpe_floor=1.0)
        assert result.best is None
        assert result.qualified == ()

    def test_evaluate_param_grid_wrapper(self):
        params = [{"x": 1.0}, {"x": 2.0}, {"x": 3.0}]

        def eval_fn(p):
            # Higher x → higher IS; OOS peaks at x=2 and is flatter nearby
            x = p["x"]
            return 1.0 + x * 0.2, 1.0 - abs(x - 2.0) * 0.1

        sel = evaluate_param_grid(params, eval_fn, n_neighbors=2)
        assert sel.best is not None
        assert sel.n_trials == 3
