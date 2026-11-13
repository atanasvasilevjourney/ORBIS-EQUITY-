"""Shared synthetic tape for strategy validation notebooks.

The path is a seeded random walk with a few large up days. It is a rule
harness, not a market sample and not a claim about live edge.
"""
from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

N_DAYS = 420
END = "2026-10-30"

UNIVERSE: list[tuple[str, str, float]] = [
    ("SYN-T1", "Technology", 0.0007),
    ("SYN-T2", "Technology", 0.0005),
    ("SYN-T3", "Technology", 0.0003),
    ("SYN-H1", "Health Care", 0.0004),
    ("SYN-H2", "Health Care", 0.0002),
    ("SYN-H3", "Health Care", 0.0001),
    ("SYN-E1", "Energy", 0.0002),
    ("SYN-E2", "Energy", -0.0001),
    ("SYN-E3", "Energy", 0.0000),
    ("SYN-F1", "Financials", 0.0004),
    ("SYN-F2", "Financials", 0.0003),
    ("SYN-F3", "Financials", 0.0001),
]


def calendar(n_days: int = N_DAYS) -> pd.DatetimeIndex:
    return pd.bdate_range(end=END, periods=n_days)


def sectors() -> dict[str, str]:
    return {sym: sec for sym, sec, _ in UNIVERSE}


def symbols() -> list[str]:
    return [sym for sym, _, _ in UNIVERSE]


def synthetic_panel(n_days: int = N_DAYS, seed: int = 7) -> dict[str, pd.DataFrame]:
    """OHLCV frames with a ``date`` column, one per synthetic name."""
    idx = calendar(n_days)
    panel: dict[str, pd.DataFrame] = {}
    for i, (sym, _sec, drift) in enumerate(UNIVERSE):
        rng = np.random.default_rng(seed + i * 17)
        rets = rng.normal(drift, 0.012, n_days)
        spikes = rng.choice(np.arange(70, n_days - 2), size=8, replace=False)
        rets[spikes] = rng.uniform(0.045, 0.09, size=len(spikes))
        close = 80.0 * np.cumprod(1.0 + rets)
        open_ = np.empty(n_days)
        open_[0] = close[0] / (1.0 + rets[0])
        open_[1:] = close[:-1]
        # Spike days gap at least 4% at the open and still close above that open,
        # so the opening-range screen and the daily momentum screen can both see them.
        for s in spikes:
            if s == 0:
                continue
            prev = close[s - 1]
            open_[s] = prev * 1.041
            if close[s] <= open_[s]:
                close[s] = open_[s] * 1.012
        wick = rng.uniform(0.001, 0.008, n_days)
        high = np.maximum(open_, close) * (1.0 + wick)
        low = np.minimum(open_, close) * (1.0 - wick)
        volume = rng.integers(800_000, 1_600_000, n_days).astype(float)
        volume[spikes] *= 4.0
        panel[sym] = pd.DataFrame(
            {
                "date": idx,
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
            }
        )
    return panel


def as_of_dates(panel: dict[str, pd.DataFrame]) -> list[date]:
    frame = next(iter(panel.values()))
    return [ts.date() for ts in pd.to_datetime(frame["date"])]


def close_matrix(panel: dict[str, pd.DataFrame]) -> pd.DataFrame:
    cols = {}
    for sym, df in panel.items():
        cols[sym] = pd.Series(df["close"].to_numpy(), index=pd.to_datetime(df["date"]))
    return pd.DataFrame(cols).sort_index()


def equal_weight_returns(panel: dict[str, pd.DataFrame]) -> pd.Series:
    closes = close_matrix(panel)
    return closes.pct_change().mean(axis=1).fillna(0.0)
