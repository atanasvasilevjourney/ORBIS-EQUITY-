"""Parameter stability scoring (KAMA-DF method) for swing strategy research.

Selects strategy parameters by neighborhood robustness, not peak in-sample
Sharpe. A candidate qualifies only if IS Sharpe clears a floor; among
qualified sets we prefer the lowest dispersion of OOS Sharpe across nearby
parameter neighbors.

This is the research/promotion gate for fixed production params (dual-KAMA
regime, EWMAC spans, etc.). It is NOT a per-ticker nightly optimizer —
production uses one global param set validated here.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Mapping, Sequence

import numpy as np


DEFAULT_IS_SHARPE_FLOOR = 1.0
DEFAULT_N_NEIGHBORS = 10


@dataclass(frozen=True)
class StabilityCandidate:
    """One evaluated parameter set with stability metrics."""

    idx: int
    params: Mapping[str, float]
    is_sharpe: float
    oos_sharpe: float
    neighbor_oos_std: float
    neighbor_indices: tuple[int, ...]


@dataclass(frozen=True)
class StabilitySelection:
    """Result of stability-based parameter selection."""

    best: StabilityCandidate | None
    qualified: tuple[StabilityCandidate, ...]
    n_trials: int
    is_sharpe_floor: float


def normalize_param_matrix(param_rows: np.ndarray) -> np.ndarray:
    """Min-max normalize each parameter column to [0, 1]."""
    rows = np.asarray(param_rows, dtype=float)
    if rows.ndim != 2 or rows.size == 0:
        raise ValueError("param_rows must be a non-empty 2D array")
    mins = rows.min(axis=0)
    maxs = rows.max(axis=0)
    return (rows - mins) / (maxs - mins + 1e-9)


def pairwise_euclidean(normalized: np.ndarray) -> np.ndarray:
    """Full pairwise Euclidean distance matrix."""
    diff = normalized[:, None, :] - normalized[None, :, :]
    return np.sqrt(np.sum(diff * diff, axis=-1))


def nearest_neighbor_indices(
    dist_mat: np.ndarray, idx: int, n_neighbors: int = DEFAULT_N_NEIGHBORS
) -> np.ndarray:
    """Return indices of the n nearest neighbors excluding self."""
    order = np.argsort(dist_mat[idx])
    excl = order[order != idx]
    k = min(n_neighbors, len(excl))
    return excl[:k]


def neighbor_metric_std(
    metric_values: np.ndarray, neighbor_idx: np.ndarray
) -> float:
    """Std of a metric over neighbor indices; 0 if fewer than 2 neighbors."""
    if len(neighbor_idx) < 2:
        return 0.0
    return float(np.std(metric_values[neighbor_idx]))


def annualized_sharpe(
    strategy_returns: np.ndarray, bars_per_year: float = 252.0
) -> float:
    """Sharpe of a return series; 0 if variance is zero / invalid."""
    r = np.asarray(strategy_returns, dtype=float)
    r = r[np.isfinite(r)]
    if len(r) < 2:
        return 0.0
    std = float(np.std(r, ddof=0))
    if std <= 0 or not np.isfinite(std):
        return 0.0
    return float((np.mean(r) / std) * np.sqrt(bars_per_year))


def score_candidates(
    params_list: Sequence[Mapping[str, float]],
    is_sharpes: Sequence[float],
    oos_sharpes: Sequence[float],
    *,
    is_sharpe_floor: float = DEFAULT_IS_SHARPE_FLOOR,
    n_neighbors: int = DEFAULT_N_NEIGHBORS,
    param_keys: Sequence[str] | None = None,
) -> StabilitySelection:
    """Score and select the most stable param set (KAMA-DF rule).

    Among trials with IS Sharpe > floor, pick the one with the lowest
    OOS Sharpe standard deviation across its nearest parameter neighbors.
    """
    if not params_list:
        return StabilitySelection(None, (), 0, is_sharpe_floor)
    if len(params_list) != len(is_sharpes) or len(params_list) != len(oos_sharpes):
        raise ValueError("params_list, is_sharpes, and oos_sharpes must align")

    keys = list(param_keys) if param_keys is not None else list(params_list[0].keys())
    matrix = np.array([[float(p[k]) for k in keys] for p in params_list], dtype=float)
    dist = pairwise_euclidean(normalize_param_matrix(matrix))

    is_arr = np.asarray(is_sharpes, dtype=float)
    oos_arr = np.asarray(oos_sharpes, dtype=float)

    candidates: list[StabilityCandidate] = []
    for i, params in enumerate(params_list):
        neigh = nearest_neighbor_indices(dist, i, n_neighbors)
        candidates.append(
            StabilityCandidate(
                idx=i,
                params=dict(params),
                is_sharpe=float(is_arr[i]),
                oos_sharpe=float(oos_arr[i]),
                neighbor_oos_std=neighbor_metric_std(oos_arr, neigh),
                neighbor_indices=tuple(int(x) for x in neigh),
            )
        )

    qualified = tuple(c for c in candidates if c.is_sharpe > is_sharpe_floor)
    if not qualified:
        return StabilitySelection(None, (), len(params_list), is_sharpe_floor)

    best = min(qualified, key=lambda c: (c.neighbor_oos_std, -c.oos_sharpe))
    return StabilitySelection(best, qualified, len(params_list), is_sharpe_floor)


def evaluate_param_grid(
    params_list: Sequence[Mapping[str, float]],
    eval_fn: Callable[[Mapping[str, float]], tuple[float, float]],
    *,
    is_sharpe_floor: float = DEFAULT_IS_SHARPE_FLOOR,
    n_neighbors: int = DEFAULT_N_NEIGHBORS,
) -> StabilitySelection:
    """Evaluate each param set via eval_fn → (is_sharpe, oos_sharpe), then score.

    eval_fn should run the same strategy on train and test splits and return
    annualized Sharpes. Used as the promotion gate before freezing production
    constants in trend_radar / kama_regime.
    """
    is_vals: list[float] = []
    oos_vals: list[float] = []
    for params in params_list:
        is_s, oos_s = eval_fn(params)
        is_vals.append(float(is_s))
        oos_vals.append(float(oos_s))
    return score_candidates(
        params_list,
        is_vals,
        oos_vals,
        is_sharpe_floor=is_sharpe_floor,
        n_neighbors=n_neighbors,
    )
