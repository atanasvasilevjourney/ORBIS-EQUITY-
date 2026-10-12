"""TEMA-only top-N book: rank on IS, validate on OOS, optional equal-weight portfolio.

Uses production TEMA 9/99/199 + MACD close (see `pipeline.research.tema_backtest`).
Selection is **causal**: tickers are ranked by in-sample (60%) TEMA Sharpe; the top
`TOP_N` names are held through the out-of-sample (40%) window for reporting.

Gate (`OOS_GATE`) must pass before promoting a live top-10 list (notebook default).

Usage:
    PYTHONPATH=/workspace python3 -m pipeline.research.tema_top10_oos
    PYTHONPATH=/workspace python3 -m pipeline.research.tema_top10_oos --top 10 --out pipeline/research/artifacts/tema_top10_oos.json
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from pipeline.compute.perps_math import MIN_BARS
from pipeline.research.kama_backtest import (
    BARS_PER_YEAR,
    TRAIN_RATIO,
    compute_metrics,
    download_close,
    split_train_test,
)
from pipeline.research.tema_backtest import strategy_returns

# Liquid US names aligned with `src/lib/liteDeskApi.ts` LIQUID_NAMES
DEFAULT_UNIVERSE: tuple[str, ...] = (
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "JPM", "XOM",
    "JNJ", "PG", "UNH", "V", "HD", "CVX", "LLY", "AVGO",
    "COST", "WMT", "BAC", "ORCL", "AMD", "NFLX", "KO", "DIS",
)

DEFAULT_START = "2018-01-01"
TOP_N = 10
MIN_IS_TRADES = 4
MIN_OOS_BARS = 60

# Fixed liquid book (matches `/cash` default watch); validate OOS without IS rank lookahead.
FIXED_TOP10: tuple[str, ...] = (
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "JPM", "XOM", "JNJ", "V"
)

SelectionMode = str  # "is_rank" | "fixed"

# Promotion gate for a TEMA-only top-10 book (research defaults — tune in notebook).
OOS_GATE = {
    "min_portfolio_oos_sharpe": 0.35,
    "min_median_ticker_oos_sharpe": 0.0,
    "min_fraction_oos_sharpe_positive": 0.55,
    "min_portfolio_oos_cagr_vs_bh": -0.05,  # TEMA EW port CAGR − EW B&H CAGR (fraction)
}


@dataclass(frozen=True)
class TickerSplit:
    ticker: str
    n_bars: int
    is_sharpe: float
    oos_sharpe: float
    is_cagr: float
    oos_cagr: float
    oos_max_dd: float
    oos_trades: int
    train_end: str
    test_start: str
    test_end: str


@dataclass
class Top10Result:
    universe: list[str]
    top_n: int
    top10: list[str]
    ranked: list[TickerSplit]
    gate_passed: bool
    gate_reason: str
    gate_checks: dict[str, bool]
    portfolio_oos: dict | None
    portfolio_bh_oos: dict | None
    train_ratio: float = TRAIN_RATIO
    start: str = DEFAULT_START


def _metrics_on_slice(close: np.ndarray) -> dict:
    strat, pos = strategy_returns(close)
    if strat.size < 2:
        m = compute_metrics(strat, position=pos[:-1] if pos.size else None)
        return asdict(m)
    m = compute_metrics(strat, position=pos[:-1])
    return asdict(m)


def evaluate_ticker(ticker: str, close: pd.Series, train_ratio: float = TRAIN_RATIO) -> TickerSplit | None:
    if len(close) < MIN_BARS + 60:
        return None
    try:
        train, test = split_train_test(close, train_ratio)
    except ValueError:
        return None
    is_m = _metrics_on_slice(train.to_numpy(dtype=float))
    oos_m = _metrics_on_slice(test.to_numpy(dtype=float))
    if is_m["trades"] < MIN_IS_TRADES:
        return None
    if oos_m["bars"] < MIN_OOS_BARS:
        return None
    return TickerSplit(
        ticker=ticker,
        n_bars=len(close),
        is_sharpe=float(is_m["sharpe"]),
        oos_sharpe=float(oos_m["sharpe"]),
        is_cagr=float(is_m["cagr"]),
        oos_cagr=float(oos_m["cagr"]),
        oos_max_dd=float(oos_m["max_drawdown"]),
        oos_trades=int(oos_m["trades"]),
        train_end=str(train.index[-1].date()),
        test_start=str(test.index[0].date()),
        test_end=str(test.index[-1].date()),
    )


def _daily_tema_returns(close: pd.Series) -> pd.Series:
    x = close.to_numpy(dtype=float)
    strat, _pos = strategy_returns(x)
    idx = close.index[1:]
    if len(strat) != len(idx):
        strat = strat[: len(idx)]
    return pd.Series(strat, index=idx, name=close.name)


def portfolio_oos_returns(
    tickers: list[str], closes: dict[str, pd.Series]
) -> tuple[pd.DatetimeIndex, np.ndarray, np.ndarray]:
    """Equal-weight TEMA returns and equal-weight buy-and-hold on the shared OOS index."""
    frames: list[pd.Series] = []
    bh_frames: list[pd.Series] = []
    for t in tickers:
        c = closes[t]
        train, test = split_train_test(c, TRAIN_RATIO)
        tr = _daily_tema_returns(test)
        bh = test.pct_change().fillna(0.0)
        bh.index = test.index
        frames.append(tr)
        bh_frames.append(bh.reindex(tr.index).fillna(0.0))
    if not frames:
        return pd.DatetimeIndex([]), np.array([]), np.array([])
    panel = pd.concat(frames, axis=1).fillna(0.0)
    bh_panel = pd.concat(bh_frames, axis=1).fillna(0.0)
    port = panel.mean(axis=1)
    bh = bh_panel.mean(axis=1)
    return port.index, port.to_numpy(dtype=float), bh.to_numpy(dtype=float)


def check_gate(
    top_rows: list[TickerSplit],
    port_oos: dict,
    bh_oos: dict,
    gate: dict | None = None,
) -> tuple[bool, str, dict[str, bool]]:
    g = gate or OOS_GATE
    oos_sharpes = [r.oos_sharpe for r in top_rows]
    frac_pos = sum(1 for s in oos_sharpes if s > 0) / max(len(oos_sharpes), 1)
    median_oos = float(np.median(oos_sharpes)) if oos_sharpes else -1.0
    cagr_gap = float(port_oos["cagr"]) - float(bh_oos["cagr"])

    checks = {
        "portfolio_oos_sharpe": port_oos["sharpe"] >= g["min_portfolio_oos_sharpe"],
        "median_ticker_oos_sharpe": median_oos >= g["min_median_ticker_oos_sharpe"],
        "fraction_oos_sharpe_positive": frac_pos >= g["min_fraction_oos_sharpe_positive"],
        "portfolio_cagr_vs_bh": cagr_gap >= g["min_portfolio_oos_cagr_vs_bh"],
    }
    passed = all(checks.values())
    if passed:
        reason = "All OOS gate checks passed — top-N list is research-promotable."
    else:
        failed = [k for k, ok in checks.items() if not ok]
        reason = f"Gate failed: {', '.join(failed)}. Do not promote top-{len(top_rows)} to live sizing."
    return passed, reason, checks


def run_top10(
    tickers: list[str] | None = None,
    start: str = DEFAULT_START,
    top_n: int = TOP_N,
    train_ratio: float = TRAIN_RATIO,
    gate: dict | None = None,
    selection: SelectionMode = "is_rank",
) -> Top10Result:
    universe = list(tickers or DEFAULT_UNIVERSE)
    ranked_rows: list[TickerSplit] = []
    closes: dict[str, pd.Series] = {}

    for t in universe:
        try:
            close = download_close(t, start)
            closes[t] = close
            row = evaluate_ticker(t, close, train_ratio)
            if row:
                ranked_rows.append(row)
        except Exception:
            continue

    ranked_rows.sort(key=lambda r: r.is_sharpe, reverse=True)
    if selection == "fixed":
        fixed = [t for t in FIXED_TOP10 if t in closes][:top_n]
        by_t = {r.ticker: r for r in ranked_rows}
        top_rows = [by_t[t] for t in fixed if t in by_t]
        top = [r.ticker for r in top_rows]
    else:
        top = [r.ticker for r in ranked_rows[:top_n]]
        top_rows = ranked_rows[:top_n]

    port_oos_dict: dict | None = None
    bh_oos_dict: dict | None = None
    if len(top) >= 2:
        _idx, port_r, bh_r = portfolio_oos_returns(top, closes)
        if port_r.size >= MIN_OOS_BARS:
            port_oos_dict = asdict(compute_metrics(port_r))
            bh_oos_dict = asdict(compute_metrics(bh_r))

    if port_oos_dict and bh_oos_dict and top_rows:
        passed, reason, checks = check_gate(top_rows, port_oos_dict, bh_oos_dict, gate)
    else:
        passed, reason, checks = False, "Insufficient history or too few names for portfolio OOS.", {}

    return Top10Result(
        universe=universe,
        top_n=top_n,
        top10=top,
        ranked=ranked_rows,
        gate_passed=passed,
        gate_reason=reason,
        gate_checks=checks,
        portfolio_oos=port_oos_dict,
        portfolio_bh_oos=bh_oos_dict,
        train_ratio=train_ratio,
        start=start,
    )


def run_quick(tickers: list[str], start: str = DEFAULT_START, top_n: int = TOP_N) -> Top10Result:
    """Notebook-friendly alias."""
    return run_top10(tickers=tickers, start=start, top_n=top_n)


def oos_positive_alternates(result: Top10Result, limit: int = TOP_N) -> list[TickerSplit]:
    """Research helper when gate fails: highest OOS Sharpe names (same universe scan)."""
    pos = [r for r in result.ranked if r.oos_sharpe > 0]
    pos.sort(key=lambda r: r.oos_sharpe, reverse=True)
    return pos[:limit]


def portfolio_equity_curve(tickers: list[str], closes: dict[str, pd.Series]) -> pd.DataFrame:
    """Cumulative equal-weight TEMA vs B&H on OOS window for selected tickers."""
    idx, port_r, bh_r = portfolio_oos_returns(tickers, closes)
    if port_r.size == 0:
        return pd.DataFrame()
    tema_eq = np.cumprod(1.0 + port_r)
    bh_eq = np.cumprod(1.0 + bh_r)
    return pd.DataFrame({"tema_ew": tema_eq, "bh_ew": bh_eq}, index=idx)


def result_to_jsonable(result: Top10Result) -> dict:
    return {
        "universe": result.universe,
        "top_n": result.top_n,
        "top10": result.top10,
        "gate_passed": result.gate_passed,
        "gate_reason": result.gate_reason,
        "gate_checks": result.gate_checks,
        "portfolio_oos": result.portfolio_oos,
        "portfolio_bh_oos": result.portfolio_bh_oos,
        "train_ratio": result.train_ratio,
        "start": result.start,
        "ranked": [asdict(r) for r in result.ranked],
    }


def print_report(result: Top10Result) -> None:
    print("=" * 88)
    print(f"TEMA TOP-{result.top_n} — rank IS Sharpe ({result.train_ratio:.0%} train) · validate OOS")
    print("=" * 88)
    print(f"Universe n={len(result.universe)} · qualified={len(result.ranked)} · start={result.start}")
    print(f"\nSelected top-{result.top_n} (IS rank): {', '.join(result.top10) or '—'}")
    print(f"\nGate: {'PASS' if result.gate_passed else 'FAIL'} — {result.gate_reason}")
    for k, ok in result.gate_checks.items():
        print(f"  {k}: {'OK' if ok else 'NO'}")

    if result.portfolio_oos and result.portfolio_bh_oos:
        p, b = result.portfolio_oos, result.portfolio_bh_oos
        print("\nEqual-weight OOS (top-N only, shared calendar):")
        print(
            f"  TEMA  Sharpe={p['sharpe']:6.2f}  CAGR={p['cagr']*100:6.1f}%  "
            f"MaxDD={p['max_drawdown']*100:6.1f}%  Trades={p['trades']}"
        )
        print(
            f"  B&H   Sharpe={b['sharpe']:6.2f}  CAGR={b['cagr']*100:6.1f}%  "
            f"MaxDD={b['max_drawdown']*100:6.1f}%"
        )

    print(f"\n{'Rank':<5} {'Ticker':<6} {'IS Sh':>7} {'OOS Sh':>7} {'OOS CAGR':>9} {'OOS MaxDD':>10}")
    for i, r in enumerate(result.ranked[: max(result.top_n, 15)], 1):
        mark = "*" if r.ticker in result.top10 else " "
        print(
            f"{mark}{i:<4} {r.ticker:<6} {r.is_sharpe:7.2f} {r.oos_sharpe:7.2f} "
            f"{r.oos_cagr*100:8.1f}% {r.oos_max_dd*100:9.1f}%"
        )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--tickers", default=",".join(DEFAULT_UNIVERSE))
    p.add_argument("--start", default=DEFAULT_START)
    p.add_argument("--top", type=int, default=TOP_N)
    p.add_argument(
        "--selection",
        choices=("is_rank", "fixed"),
        default="is_rank",
        help="is_rank: top IS Sharpe; fixed: FIXED_TOP10 list",
    )
    p.add_argument(
        "--out",
        default="pipeline/research/artifacts/tema_top10_oos.json",
        help="JSON report path",
    )
    args = p.parse_args(argv)
    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    result = run_top10(
        tickers=tickers, start=args.start, top_n=args.top, selection=args.selection
    )
    print_report(result)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result_to_jsonable(result), indent=2))
    print(f"\nWrote {out}")
    return 0 if result.gate_passed else 1


if __name__ == "__main__":
    sys.exit(main())
