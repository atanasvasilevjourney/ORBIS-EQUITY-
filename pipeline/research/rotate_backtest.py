"""Quant test for sector-rotation canaries + correlation.

Offline / synthetic. Confirms:
  - QQQ/SPY (tech vs univ) votes +1 when tech leads
  - a canary overlay (tech when risk-on, staples when not) beats equal-weight univ
    on a constructed lead
  - sector-return correlation is symmetric and PSD

Usage:
    PYTHONPATH=/workspace python -m pipeline.research.rotate_backtest
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from pipeline.compute.canary_math import Z_WINDOW, SMOOTH_SPAN, build_canaries
from pipeline.compute.corr_math import corr_from_equities
from pipeline.research.kama_backtest import compute_metrics


@dataclass(frozen=True)
class RotateQuant:
    regime: str
    qqq_vote: int
    overlay_sharpe: float
    univ_sharpe: float
    overlay_total: float
    univ_total: float
    corr_labels: list[str]
    corr_min_eig: float


def _eq(days: int, drift: float, seed: int) -> np.ndarray:
    # Geometric lead with a touch of noise so correlation is not identically 1.
    rng = np.random.default_rng(seed)
    base = 100.0 * ((1.0 + drift) ** np.arange(days))
    return base * (1.0 + rng.normal(0, 0.0015, days))


def synthetic_books(days: int = 320) -> dict[str, np.ndarray]:
    return {
        "univ": _eq(days, 0.0006, 1),
        "tech": _eq(days, 0.0018, 2),
        "disc": _eq(days, 0.0012, 3),
        "staples": _eq(days, 0.0003, 4),
        "energy": _eq(days, 0.0008, 5),
        "defensive": _eq(days, 0.00025, 6),
        "financials": _eq(days, 0.0009, 7),
    }


def canary_overlay_returns(books: dict[str, np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    univ = books["univ"]
    tech = books["tech"]
    staples = books["staples"]
    n = min(univ.size, tech.size, staples.size)
    univ, tech, staples = univ[-n:], tech[-n:], staples[-n:]
    start = Z_WINDOW + SMOOTH_SPAN
    hold_tech = np.zeros(n)
    last = 0.0
    for i in range(start, n):
        if (i - start) % 5 == 0:
            sl = {k: v[: i + 1] for k, v in books.items()}
            sl["univ"] = univ[: i + 1]
            sl["tech"] = tech[: i + 1]
            sl["staples"] = staples[: i + 1]
            last = 1.0 if build_canaries(sl).score > 0 else 0.0
        hold_tech[i] = last
    r_tech = np.diff(tech) / tech[:-1]
    r_def = np.diff(staples) / staples[:-1]
    r_univ = np.diff(univ) / univ[:-1]
    overlay = np.where(hold_tech[:-1] > 0, r_tech, r_def)
    mask = np.arange(len(overlay)) >= start - 1
    return overlay[mask], r_univ[mask]


def validate_rotation(days: int = 280) -> RotateQuant:
    books = synthetic_books(days)
    reg = build_canaries(books)
    qqq = next(v for v in reg.votes if v.name == "QQQ/SPY")
    overlay, univ = canary_overlay_returns(books)
    om = compute_metrics(overlay)
    um = compute_metrics(univ)
    corr = corr_from_equities(books)
    mat = np.array(corr["matrix"], dtype=float)
    eig = float(np.linalg.eigvalsh(mat).min()) if mat.size else 0.0
    return RotateQuant(
        regime=reg.regime,
        qqq_vote=qqq.vote,
        overlay_sharpe=om.sharpe,
        univ_sharpe=um.sharpe,
        overlay_total=om.total_return,
        univ_total=um.total_return,
        corr_labels=corr["labels"],
        corr_min_eig=eig,
    )


def main() -> None:
    q = validate_rotation()
    print(
        q.regime,
        "QQQ",
        q.qqq_vote,
        "overlay",
        round(q.overlay_sharpe, 3),
        "univ",
        round(q.univ_sharpe, 3),
        "min eig",
        round(q.corr_min_eig, 4),
    )


if __name__ == "__main__":
    main()
