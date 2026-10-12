"""Pearson correlation payload for desk JSONB (Quantropy + ROTATE)."""
from __future__ import annotations

import numpy as np


def _pairwise_pearson_matrix(rets: np.ndarray, *, min_obs: int = 8) -> np.ndarray:
    """N×N correlation with pairwise deletion of non-finite days per pair."""
    x = np.asarray(rets, dtype=float)
    n_cols = x.shape[1]
    out = np.full((n_cols, n_cols), np.nan, dtype=float)
    for i in range(n_cols):
        out[i, i] = 1.0
        for j in range(i + 1, n_cols):
            mask = np.isfinite(x[:, i]) & np.isfinite(x[:, j])
            if int(mask.sum()) < min_obs:
                continue
            xi = x[mask, i]
            xj = x[mask, j]
            if np.std(xi) <= 1e-15 or np.std(xj) <= 1e-15:
                continue
            r = float(np.corrcoef(xi, xj)[0, 1])
            out[i, j] = out[j, i] = r
    return out


def corr_from_returns(labels: list[str], rets: np.ndarray) -> dict:
    """`rets` is T×N. Returns JSON-safe {labels, matrix}."""
    names = [str(x) for x in labels]
    x = np.asarray(rets, dtype=float)
    if x.ndim != 2 or x.shape[1] < 2 or x.shape[0] < 8:
        return {"labels": names, "matrix": []}
    c = _pairwise_pearson_matrix(x)
    matrix = [
        [None if not np.isfinite(v) else round(float(v), 4) for v in row]
        for row in c
    ]
    return {"labels": names, "matrix": matrix}


def corr_from_equities(series: dict[str, np.ndarray]) -> dict:
    labels: list[str] = []
    book: list[np.ndarray] = []
    for name, eq in series.items():
        x = np.asarray(eq, dtype=float)
        if x.size < 61:
            continue
        prev = x[:-1]
        with np.errstate(divide="ignore", invalid="ignore"):
            r = np.diff(x) / np.where(prev == 0, np.nan, prev)
        labels.append(str(name))
        book.append(r)
    if len(book) < 2:
        return {"labels": labels, "matrix": []}
    n = min(len(x) for x in book)
    arr = np.vstack([x[-n:] for x in book]).T
    return corr_from_returns(labels, arr)
