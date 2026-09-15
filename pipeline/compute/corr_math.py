"""Pearson correlation payload for desk JSONB (Quantropy + ROTATE)."""
from __future__ import annotations

import numpy as np


def corr_from_returns(labels: list[str], rets: np.ndarray) -> dict:
    """`rets` is T×N. Returns JSON-safe {labels, matrix}."""
    names = [str(x) for x in labels]
    if rets.ndim != 2 or rets.shape[1] < 2 or rets.shape[0] < 8:
        return {"labels": names, "matrix": []}
    c = np.corrcoef(np.asarray(rets, dtype=float), rowvar=False)
    c = np.atleast_2d(c)
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
        r = np.diff(x) / np.where(prev == 0, np.nan, prev)
        r = np.nan_to_num(r, nan=0.0)
        labels.append(str(name))
        book.append(r)
    if len(book) < 2:
        return {"labels": labels, "matrix": []}
    n = min(len(x) for x in book)
    arr = np.vstack([x[-n:] for x in book]).T
    return corr_from_returns(labels, arr)
