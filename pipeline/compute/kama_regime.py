"""Dual-KAMA regime filter for the swing strategy stack.

Kaufman Adaptive MA (short vs long) provides a volatility-aware trend regime
gate. Production uses one global param set — not per-ticker Optuna.

Defaults below are literature-style Kaufman settings chosen for neighborhood
stability (promote via pipeline.compute.param_stability before changing).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# Stability-promoted production defaults (global, not per-ticker).
# Change only after param_stability.score_candidates / evaluate_param_grid.
KAMA_SHORT_N = 10
KAMA_SHORT_FAST = 2
KAMA_SHORT_SLOW = 30
KAMA_LONG_N = 30
KAMA_LONG_FAST = 2
KAMA_LONG_SLOW = 30

# Minimum bars to compute both KAMAs with warmup
KAMA_MIN_HISTORY = KAMA_LONG_N + 5


def calculate_kama(
    series: pd.Series,
    n: int = 10,
    fast: int = 2,
    slow: int = 30,
) -> pd.Series:
    """Kaufman Adaptive Moving Average.

    Efficiency Ratio (ER) scales the smoothing constant between fast and slow
    EMA-equivalent rates so the MA tracks in trends and slows in chop.
    """
    if len(series) <= n:
        return pd.Series(np.nan, index=series.index)

    change = (series - series.shift(n)).abs()
    volatility = (series - series.shift(1)).abs().rolling(window=n).sum()
    er = change / (volatility + 1e-9)

    fast_sc = 2.0 / (fast + 1)
    slow_sc = 2.0 / (slow + 1)
    sc = (er * (fast_sc - slow_sc) + slow_sc) ** 2

    kama = np.full(len(series), np.nan, dtype=float)
    kama[n] = float(series.iloc[n])
    sc_vals = sc.to_numpy(dtype=float)
    prices = series.to_numpy(dtype=float)

    for i in range(n + 1, len(series)):
        if not np.isfinite(sc_vals[i]):
            kama[i] = kama[i - 1]
            continue
        kama[i] = kama[i - 1] + sc_vals[i] * (prices[i] - kama[i - 1])

    return pd.Series(kama, index=series.index)


def dual_kama_position(
    close: pd.Series,
    *,
    n_short: int = KAMA_SHORT_N,
    fast_short: int = KAMA_SHORT_FAST,
    slow_short: int = KAMA_SHORT_SLOW,
    n_long: int = KAMA_LONG_N,
    fast_long: int = KAMA_LONG_FAST,
    slow_long: int = KAMA_LONG_SLOW,
) -> pd.Series:
    """Long-only position: 1 when short KAMA > long KAMA (shifted 1 bar)."""
    ks = calculate_kama(close, n=n_short, fast=fast_short, slow=slow_short)
    kl = calculate_kama(close, n=n_long, fast=fast_long, slow=slow_long)
    raw = (ks > kl).astype(float)
    return raw.shift(1).fillna(0.0)


def compute_kama_regime(close: pd.Series) -> int:
    """Current dual-KAMA regime: 1=bullish, -1=bearish, 0=unknown/warmup.

    Bullish when prior close is above the long KAMA (adaptive long-term MA).
    Short/long KAMA crosses are used in research backtests via
    dual_kama_position; production regime uses price vs long KAMA because
    short and long KAMA converge under high ER and a raw cross is brittle.

    Uses production defaults. Intended as a Trend Radar regime confirmation
    gate (high-leverage layer), not a standalone entry trigger.
    """
    if len(close) < KAMA_MIN_HISTORY:
        return 0

    kl = calculate_kama(
        close, n=KAMA_LONG_N, fast=KAMA_LONG_FAST, slow=KAMA_LONG_SLOW
    )
    # Prior bar (no same-bar lookahead)
    if not np.isfinite(kl.iloc[-2]):
        return 0
    return 1 if float(close.iloc[-2]) > float(kl.iloc[-2]) else -1


def strategy_returns_for_params(
    close: pd.Series, params: dict
) -> np.ndarray:
    """Daily strategy returns for a dual-KAMA param dict (for stability eval)."""
    pos = dual_kama_position(
        close,
        n_short=int(params["n_short"]),
        fast_short=int(params["fast_short"]),
        slow_short=int(params["slow_short"]),
        n_long=int(params["n_long"]),
        fast_long=int(params["fast_long"]),
        slow_long=int(params["slow_long"]),
    )
    rets = close.pct_change().fillna(0.0) * pos
    return rets.to_numpy(dtype=float)
