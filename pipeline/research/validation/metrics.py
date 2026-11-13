"""Equity, drawdown, and summary stats for validation notebooks."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from pipeline.strategies.costs import DEFAULT_LOOP_COSTS

BARS_PER_YEAR = 252.0
ROUND_TRIP_PCT = DEFAULT_LOOP_COSTS.bps_per_side * 2.0 / 100.0  # percent points


@dataclass
class ModuleRun:
    module_id: str
    title: str
    rules: list[str]
    equity: pd.Series
    benchmark: pd.Series
    trade_returns_pct: np.ndarray
    metrics: dict
    note: str
    extra: dict = field(default_factory=dict)


def equity_curve(daily_returns: pd.Series) -> pd.Series:
    r = pd.Series(daily_returns, dtype=float).fillna(0.0)
    curve = (1.0 + r).cumprod()
    curve.name = "equity"
    return curve


def max_drawdown(equity: pd.Series) -> float:
    if equity.empty:
        return 0.0
    peak = equity.cummax()
    dd = equity / peak.replace(0, np.nan) - 1.0
    return float(dd.min()) if len(dd) else 0.0


def sharpe(daily_returns: pd.Series) -> float:
    r = pd.Series(daily_returns, dtype=float).dropna()
    if len(r) < 2 or float(r.std(ddof=1)) == 0.0:
        return 0.0
    return float(r.mean() / r.std(ddof=1) * np.sqrt(BARS_PER_YEAR))


def summarize(daily_returns: pd.Series, trades_pct: np.ndarray) -> dict:
    eq = equity_curve(daily_returns)
    years = max(len(daily_returns) / BARS_PER_YEAR, 1e-9)
    total = float(eq.iloc[-1] - 1.0) if len(eq) else 0.0
    cagr = float(eq.iloc[-1] ** (1.0 / years) - 1.0) if len(eq) and eq.iloc[-1] > 0 else 0.0
    trades = np.asarray(trades_pct, dtype=float)
    wins = float((trades > 0).mean() * 100.0) if trades.size else 0.0
    return {
        "days": int(len(daily_returns)),
        "total_return_pct": round(total * 100.0, 2),
        "cagr_pct": round(cagr * 100.0, 2),
        "sharpe": round(sharpe(daily_returns), 2),
        "max_drawdown_pct": round(max_drawdown(eq) * 100.0, 2),
        "n_trades": int(trades.size),
        "win_rate_pct": round(wins, 2),
        "avg_trade_pct": round(float(trades.mean()), 3) if trades.size else 0.0,
    }


def side_cost_fraction() -> float:
    """One side of the paper cost model, as a return fraction (10 bps = 0.001)."""
    return DEFAULT_LOOP_COSTS.bps_per_side / 10_000.0


def apply_turnover(weight: np.ndarray, bar_returns: np.ndarray) -> np.ndarray:
    """Weight times the bar return, minus one side of costs on the weight that changed.

    ``weight[i]`` earns ``bar_returns[i]``. A move from flat to a full long
    pays one side. Leaving that long pays the other side.
    """
    w = np.nan_to_num(np.asarray(weight, dtype=float))
    r = np.nan_to_num(np.asarray(bar_returns, dtype=float))
    n = min(len(w), len(r))
    w = w[:n]
    r = r[:n]
    delta = np.abs(np.diff(w, prepend=0.0))
    return w * r - delta * side_cost_fraction()


def spell_returns(position: np.ndarray, bar_returns: np.ndarray) -> np.ndarray:
    """Percent return of each non-flat spell, after a round trip of paper costs.

    ``position`` is the weight applied to the matching ``bar_returns`` slot.
    A spell ends when the weight hits zero or changes sign.
    """
    pos = np.asarray(position, dtype=float)
    rets = np.asarray(bar_returns, dtype=float)
    n = min(len(pos), len(rets))
    out: list[float] = []
    acc = 0.0
    open_spell = False
    sign = 0.0
    for i in range(n):
        w = float(pos[i])
        if w == 0.0 or not np.isfinite(w):
            if open_spell:
                out.append(acc * 100.0 - ROUND_TRIP_PCT)
                acc = 0.0
                open_spell = False
            continue
        this = 1.0 if w > 0 else -1.0
        if open_spell and this != sign:
            out.append(acc * 100.0 - ROUND_TRIP_PCT)
            acc = 0.0
        open_spell = True
        sign = this
        acc += w * float(rets[i] if np.isfinite(rets[i]) else 0.0)
    if open_spell:
        out.append(acc * 100.0 - ROUND_TRIP_PCT)
    return np.asarray(out, dtype=float)


def align_benchmark(strategy_returns: pd.Series, benchmark: pd.Series) -> tuple[pd.Series, pd.Series]:
    both = pd.concat(
        [strategy_returns.rename("strategy"), benchmark.rename("benchmark")],
        axis=1,
    ).dropna(how="all").fillna(0.0)
    return both["strategy"], both["benchmark"]
