"""Backtest the cash-hold rules on an adjusted-close panel.

Daily equal weight is the book measured in the ensemble study. The quarterly
rule is the tradable version: hold, then rebalance on the first session of
January, April, July, and October, or when a weight drifts more than 5
percentage points. Costs are charged on one-way turnover.

Usage:
    PYTHONPATH=/workspace python -m pipeline.research.cash_hold_backtest
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence

import numpy as np
import pandas as pd

from pipeline.research.kama_backtest import compute_metrics, download_close
from pipeline.strategies.cash_hold import DRIFT_BAND, REBALANCE_MONTHS

DEFAULT_COST_BPS = 5.0
DEFAULT_START = "2010-01-01"
DEFAULT_TICKERS = ("SPY", "QQQ", "IWM", "AAPL", "MSFT", "XOM", "JPM", "ADM", "AON")


def _folds(n_rets: int) -> dict[str, slice]:
    """50% train, 25% validation, 25% locked, on the return index."""
    a = int(n_rets * 0.50)
    b = int(n_rets * 0.75)
    if a < 80 or b - a < 40 or n_rets - b < 40:
        raise ValueError(f"not enough returns to fold: {n_rets}")
    return {"train": slice(0, a), "valid": slice(a, b), "lock": slice(b, n_rets)}


def _targets(n: int) -> np.ndarray:
    from pipeline.strategies.cash_hold import MAX_NAME_WEIGHT

    weight = min(1.0 / n, MAX_NAME_WEIGHT)
    raw = np.full(n, weight, dtype=float)
    gross = float(raw.sum())
    if gross > 1.0:
        raw /= gross
    return raw


def simulate_quarterly(closes: pd.DataFrame, cost_bps: float = DEFAULT_COST_BPS) -> pd.Series:
    """Long-only hold. Returns a NAV series indexed by the close dates after the first."""
    px = closes.to_numpy(dtype=float)
    dates = pd.DatetimeIndex(closes.index)
    n_rows, n = px.shape
    if n_rows < 3 or n < 1:
        raise ValueError("need a price panel")
    target = _targets(n)
    w = target.copy()
    nav = 1.0
    values: list[float] = []
    index: list[pd.Timestamp] = []
    for i in range(1, n_rows):
        prev = px[i - 1]
        cur = px[i]
        rets = np.where(prev > 0, cur / prev - 1.0, 0.0)
        rets = np.nan_to_num(rets, nan=0.0)
        nav *= 1.0 + float(np.sum(w * rets))
        grown = w * (1.0 + rets)
        gross = float(grown.sum())
        if gross > 0:
            w = grown / gross
        as_of = pd.Timestamp(dates[i])
        prev_day = pd.Timestamp(dates[i - 1])
        quarter = as_of.month in REBALANCE_MONTHS and (
            prev_day.year != as_of.year or prev_day.month != as_of.month
        )
        drift = bool(np.any(np.abs(w - target) > DRIFT_BAND + 1e-12))
        if quarter or drift:
            one_way = 0.5 * float(np.abs(w - target).sum())
            nav *= 1.0 - one_way * (cost_bps / 10_000.0)
            w = target.copy()
        values.append(nav)
        index.append(as_of)
    start = pd.Timestamp(dates[0])
    return pd.Series([1.0, *values], index=pd.DatetimeIndex([start, *index]), name="nav")


def simulate_daily_equal(closes: pd.DataFrame) -> pd.Series:
    """Daily-rebalanced equal weight. This is the panel mean used in the ensemble study."""
    rets = closes.pct_change().iloc[1:]
    mean = rets.mean(axis=1).fillna(0.0)
    nav = (1.0 + mean).cumprod()
    return pd.Series([1.0, *nav.to_list()], index=pd.DatetimeIndex([closes.index[0], *nav.index]), name="nav")


def _fold_report(nav: pd.Series) -> dict[str, dict]:
    rets = nav.pct_change().fillna(0.0).to_numpy(dtype=float)
    # NAV starts at the first return already compounded, so pct_change[0] is 0.
    # Drop that placeholder so the fold lengths match the return history.
    rets = rets[1:]
    folds = _folds(len(rets))
    out = {}
    for name, sl in folds.items():
        m = compute_metrics(rets[sl])
        out[name] = {
            "sharpe": round(m.sharpe, 4),
            "cagr": round(m.cagr, 4),
            "max_drawdown": round(m.max_drawdown, 4),
            "total_return": round(m.total_return, 4),
            "volatility": round(m.volatility, 4),
            "bars": m.bars,
        }
    idx = nav.index[1:]
    out["spans"] = {
        name: [str(idx[sl.start].date()), str(idx[min(sl.stop, len(idx)) - 1].date())]
        for name, sl in folds.items()
    }
    return out


def run_panel(closes: pd.DataFrame, cost_bps: float = DEFAULT_COST_BPS) -> dict:
    quarterly = simulate_quarterly(closes, cost_bps=cost_bps)
    quarterly_free = simulate_quarterly(closes, cost_bps=0.0)
    daily = simulate_daily_equal(closes)
    return {
        "start": str(pd.Timestamp(closes.index[0]).date()),
        "end": str(pd.Timestamp(closes.index[-1]).date()),
        "names": list(closes.columns),
        "cost_bps": cost_bps,
        "daily_equal_weight": _fold_report(daily),
        "quarterly_no_cost": _fold_report(quarterly_free),
        "quarterly_with_cost": _fold_report(quarterly),
    }


def format_report(result: dict) -> str:
    lines = [
        "CASH-HOLD RULES",
        f"{', '.join(result['names'])}  {result['start']} → {result['end']}",
        f"Quarterly rebalance cost: {result['cost_bps']:.1f} bps one-way",
        "",
    ]
    labels = (
        ("daily equal weight", "daily_equal_weight"),
        ("quarterly, no cost", "quarterly_no_cost"),
        ("quarterly, with cost", "quarterly_with_cost"),
    )
    for title, key in labels:
        block = result[key]
        span = block["spans"]["lock"]
        lines.append(f"{title}  lock {span[0]} → {span[1]}")
        for fold in ("train", "valid", "lock"):
            m = block[fold]
            lines.append(
                f"  {fold:<5} Sharpe={m['sharpe']:7.3f}  CAGR={m['cagr']*100:7.2f}%  "
                f"MaxDD={m['max_drawdown']*100:7.2f}%  Return={m['total_return']*100:8.2f}%"
            )
        lines.append("")
    return "\n".join(lines).rstrip()


def load_closes(tickers: Sequence[str], start: str) -> pd.DataFrame:
    series = {t: download_close(t, start) for t in tickers}
    frame = pd.concat(series, axis=1, join="inner").dropna(how="any")
    frame.columns = list(series.keys())
    return frame


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--tickers", default=",".join(DEFAULT_TICKERS))
    p.add_argument("--start", default=DEFAULT_START)
    p.add_argument("--cost-bps", type=float, default=DEFAULT_COST_BPS)
    p.add_argument("--out", default="pipeline/research/artifacts/cash_hold_backtest.json")
    args = p.parse_args(argv)
    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    result = run_panel(load_closes(tickers, args.start), cost_bps=args.cost_bps)
    text = format_report(result)
    print(text)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2))
    print(f"\nWrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
