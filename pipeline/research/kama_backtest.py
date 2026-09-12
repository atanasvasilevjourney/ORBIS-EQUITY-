"""IS/OOS backtest + KAMA-DF stability validation for dual-KAMA.

Research harness (not the nightly pipeline). Downloads daily closes, splits
60/40, scores a dual-KAMA param grid by neighborhood OOS Sharpe stability,
then reports IS/OOS metrics for:
  - stability-selected params (short KAMA > long KAMA)
  - production defaults
  - production regime (close > long KAMA)
  - buy & hold

Usage:
    PYTHONPATH=/workspace python -m pipeline.research.kama_backtest
    PYTHONPATH=/workspace python -m pipeline.research.kama_backtest --tickers SPY,QQQ,AAPL
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

from pipeline.compute.kama_regime import (
    KAMA_LONG_FAST,
    KAMA_LONG_N,
    KAMA_LONG_SLOW,
    KAMA_SHORT_FAST,
    KAMA_SHORT_N,
    KAMA_SHORT_SLOW,
    calculate_kama,
    dual_kama_position,
    strategy_returns_for_params,
)
from pipeline.compute.param_stability import (
    annualized_sharpe,
    score_candidates,
)

BARS_PER_YEAR = 252.0
DEFAULT_TICKERS = ("SPY", "QQQ", "IWM", "AAPL", "MSFT", "XOM", "JPM")
DEFAULT_START = "2018-01-01"
TRAIN_RATIO = 0.60
MIN_TRADES_PER_YEAR = 2.0


@dataclass(frozen=True)
class BacktestMetrics:
    sharpe: float
    cagr: float
    volatility: float
    max_drawdown: float
    win_rate: float
    trades: int
    trades_per_year: float
    total_return: float
    bars: int


@dataclass(frozen=True)
class SplitResult:
    ticker: str
    n_bars: int
    train_bars: int
    test_bars: int
    train_start: str
    train_end: str
    test_start: str
    test_end: str
    production_defaults: dict
    stable_params: dict | None
    n_grid: int
    n_qualified: int
    neighbor_oos_std: float | None
    metrics: dict[str, dict]


def production_params() -> dict:
    return {
        "n_short": KAMA_SHORT_N,
        "fast_short": KAMA_SHORT_FAST,
        "slow_short": KAMA_SHORT_SLOW,
        "n_long": KAMA_LONG_N,
        "fast_long": KAMA_LONG_FAST,
        "slow_long": KAMA_LONG_SLOW,
    }


def default_param_grid() -> list[dict]:
    """Compact dual-KAMA grid for stability scoring (global, not per-ticker Optuna)."""
    grid: list[dict] = []
    for n_short in (8, 10, 12, 15):
        for n_long in (30, 40, 50, 60):
            if n_short >= n_long:
                continue
            for fast_short, slow_short in ((2, 30), (3, 30)):
                for fast_long, slow_long in ((2, 30), (3, 40)):
                    grid.append(
                        {
                            "n_short": n_short,
                            "fast_short": fast_short,
                            "slow_short": slow_short,
                            "n_long": n_long,
                            "fast_long": fast_long,
                            "slow_long": slow_long,
                        }
                    )
    return grid


def max_drawdown(equity: np.ndarray) -> float:
    if len(equity) == 0:
        return 0.0
    peak = np.maximum.accumulate(equity)
    dd = equity / peak - 1.0
    return float(dd.min()) if len(dd) else 0.0


def count_trades(position: np.ndarray) -> int:
    if len(position) < 2:
        return 0
    flips = np.diff(position) != 0
    return int(np.sum(flips))


def compute_metrics(
    strategy_returns: np.ndarray,
    position: np.ndarray | None = None,
    bars_per_year: float = BARS_PER_YEAR,
) -> BacktestMetrics:
    r = np.asarray(strategy_returns, dtype=float)
    r = r[np.isfinite(r)]
    bars = len(r)
    years = max(bars / bars_per_year, 1e-9)

    if bars < 2:
        return BacktestMetrics(0, 0, 0, 0, 0, 0, 0, 0, bars)

    equity = np.cumprod(1.0 + r)
    total_return = float(equity[-1] - 1.0)
    cagr = float(equity[-1] ** (1.0 / years) - 1.0)
    vol = float(np.std(r, ddof=0) * np.sqrt(bars_per_year))
    sharpe = annualized_sharpe(r, bars_per_year)

    active = r[r != 0]
    win_rate = float((active > 0).mean()) if len(active) else 0.0

    if position is None:
        # Infer position flips from non-zero return streaks poorly; use return sign changes
        pos = (r != 0).astype(float)
    else:
        pos = np.asarray(position, dtype=float)
    trades = count_trades(pos)

    return BacktestMetrics(
        sharpe=sharpe,
        cagr=cagr,
        volatility=vol,
        max_drawdown=max_drawdown(equity),
        win_rate=win_rate,
        trades=trades,
        trades_per_year=trades / years,
        total_return=total_return,
        bars=bars,
    )


def regime_position(close: pd.Series, n_long: int = KAMA_LONG_N,
                    fast_long: int = KAMA_LONG_FAST,
                    slow_long: int = KAMA_LONG_SLOW) -> pd.Series:
    """Long-only when prior close > long KAMA (production regime definition)."""
    kl = calculate_kama(close, n=n_long, fast=fast_long, slow=slow_long)
    raw = (close > kl).astype(float)
    return raw.shift(1).fillna(0.0)


def metrics_for_close(
    close: pd.Series, params: dict, mode: str = "cross"
) -> BacktestMetrics:
    if mode == "cross":
        pos = dual_kama_position(close, **{k: int(params[k]) for k in params})
    elif mode == "regime":
        pos = regime_position(
            close,
            n_long=int(params["n_long"]),
            fast_long=int(params["fast_long"]),
            slow_long=int(params["slow_long"]),
        )
    elif mode == "buyhold":
        pos = pd.Series(1.0, index=close.index)
    else:
        raise ValueError(f"unknown mode: {mode}")

    rets = (close.pct_change().fillna(0.0) * pos).to_numpy(dtype=float)
    return compute_metrics(rets, position=pos.to_numpy(dtype=float))


def download_close(ticker: str, start: str) -> pd.Series:
    import yfinance as yf

    data = yf.download(ticker, start=start, progress=False, auto_adjust=True)
    if data.empty:
        raise RuntimeError(f"No data for {ticker}")
    if isinstance(data.columns, pd.MultiIndex):
        close = data["Close"]
        if isinstance(close, pd.DataFrame):
            close = close.iloc[:, 0]
    else:
        close = data["Close"]
    close = close.astype(float).dropna()
    close.name = ticker
    return close


def split_train_test(
    close: pd.Series, train_ratio: float = TRAIN_RATIO
) -> tuple[pd.Series, pd.Series]:
    idx = int(len(close) * train_ratio)
    if idx < 100 or len(close) - idx < 60:
        raise ValueError(f"Insufficient history for split: {len(close)} bars")
    return close.iloc[:idx].copy(), close.iloc[idx:].copy()


def filter_grid_by_trade_rate(
    close: pd.Series, grid: list[dict], min_tpy: float = MIN_TRADES_PER_YEAR
) -> list[dict]:
    years = max(len(close) / BARS_PER_YEAR, 1e-9)
    kept: list[dict] = []
    for p in grid:
        pos = dual_kama_position(close, **{k: int(p[k]) for k in p})
        tpy = count_trades(pos.to_numpy()) / years
        if tpy >= min_tpy:
            kept.append(p)
    return kept


def validate_ticker(
    ticker: str,
    close: pd.Series,
    grid: list[dict] | None = None,
    train_ratio: float = TRAIN_RATIO,
) -> SplitResult:
    train, test = split_train_test(close, train_ratio)
    params_grid = list(grid or default_param_grid())
    params_grid = filter_grid_by_trade_rate(train, params_grid)

    is_sharpes: list[float] = []
    oos_sharpes: list[float] = []
    for p in params_grid:
        is_r = strategy_returns_for_params(train, p)
        oos_r = strategy_returns_for_params(test, p)
        is_sharpes.append(annualized_sharpe(is_r))
        oos_sharpes.append(annualized_sharpe(oos_r))

    selection = score_candidates(params_grid, is_sharpes, oos_sharpes)
    prod = production_params()
    stable = dict(selection.best.params) if selection.best else None

    metrics: dict[str, dict] = {
        "buyhold_is": asdict(metrics_for_close(train, prod, mode="buyhold")),
        "buyhold_oos": asdict(metrics_for_close(test, prod, mode="buyhold")),
        "production_cross_is": asdict(metrics_for_close(train, prod, mode="cross")),
        "production_cross_oos": asdict(metrics_for_close(test, prod, mode="cross")),
        "production_regime_is": asdict(metrics_for_close(train, prod, mode="regime")),
        "production_regime_oos": asdict(metrics_for_close(test, prod, mode="regime")),
    }
    if stable:
        metrics["stable_cross_is"] = asdict(metrics_for_close(train, stable, mode="cross"))
        metrics["stable_cross_oos"] = asdict(metrics_for_close(test, stable, mode="cross"))
        metrics["stable_regime_is"] = asdict(metrics_for_close(train, stable, mode="regime"))
        metrics["stable_regime_oos"] = asdict(metrics_for_close(test, stable, mode="regime"))

    return SplitResult(
        ticker=ticker,
        n_bars=len(close),
        train_bars=len(train),
        test_bars=len(test),
        train_start=str(train.index[0].date()),
        train_end=str(train.index[-1].date()),
        test_start=str(test.index[0].date()),
        test_end=str(test.index[-1].date()),
        production_defaults=prod,
        stable_params=stable,
        n_grid=len(params_grid),
        n_qualified=len(selection.qualified),
        neighbor_oos_std=(
            selection.best.neighbor_oos_std if selection.best else None
        ),
        metrics=metrics,
    )


def _fmt_pct(x: float) -> str:
    return f"{x * 100:6.1f}%"


def _fmt_row(name: str, m: dict) -> str:
    return (
        f"  {name:<22} Sharpe={m['sharpe']:6.2f}  CAGR={_fmt_pct(m['cagr'])}  "
        f"Vol={_fmt_pct(m['volatility'])}  MaxDD={_fmt_pct(m['max_drawdown'])}  "
        f"WR={_fmt_pct(m['win_rate'])}  Trades={m['trades']:3d} ({m['trades_per_year']:.1f}/y)"
    )


def print_report(results: Iterable[SplitResult]) -> None:
    rows = list(results)
    print("=" * 88)
    print("KAMA-DF STABILITY VALIDATION — IS / OOS BACKTEST")
    print("=" * 88)
    for r in rows:
        print(f"\n### {r.ticker}  ({r.train_start}→{r.train_end} IS | "
              f"{r.test_start}→{r.test_end} OOS)  grid={r.n_grid} qualified={r.n_qualified}")
        if r.stable_params:
            print(f"  Stable params: {r.stable_params}  (neighbor OOS std={r.neighbor_oos_std:.4f})")
        else:
            print("  Stable params: NONE (no IS Sharpe > 1.0)")
        print(f"  Production:    {r.production_defaults}")
        print("  --- In-sample ---")
        for key in (
            "buyhold_is",
            "production_cross_is",
            "production_regime_is",
            "stable_cross_is",
            "stable_regime_is",
        ):
            if key in r.metrics:
                print(_fmt_row(key, r.metrics[key]))
        print("  --- Out-of-sample ---")
        for key in (
            "buyhold_oos",
            "production_cross_oos",
            "production_regime_oos",
            "stable_cross_oos",
            "stable_regime_oos",
        ):
            if key in r.metrics:
                print(_fmt_row(key, r.metrics[key]))

    # Aggregate OOS Sharpe summary
    print("\n" + "=" * 88)
    print("OOS SHARPE SUMMARY (equal-weight across tickers)")
    print("=" * 88)
    keys = [
        "buyhold_oos",
        "production_cross_oos",
        "production_regime_oos",
        "stable_cross_oos",
        "stable_regime_oos",
    ]
    for key in keys:
        vals = [r.metrics[key]["sharpe"] for r in rows if key in r.metrics]
        if vals:
            print(f"  {key:<22} mean={np.mean(vals):6.2f}  median={np.median(vals):6.2f}  "
                  f"min={np.min(vals):6.2f}  max={np.max(vals):6.2f}  n={len(vals)}")


def run(
    tickers: list[str],
    start: str = DEFAULT_START,
    out_json: Path | None = None,
) -> list[SplitResult]:
    results: list[SplitResult] = []
    grid = default_param_grid()
    for t in tickers:
        print(f"Downloading {t}...", flush=True)
        try:
            close = download_close(t, start)
            result = validate_ticker(t, close, grid=grid)
            results.append(result)
        except Exception as exc:
            print(f"  SKIP {t}: {exc}", flush=True)
    print_report(results)
    if out_json is not None:
        out_json.parent.mkdir(parents=True, exist_ok=True)
        payload = [asdict(r) for r in results]
        out_json.write_text(json.dumps(payload, indent=2))
        print(f"\nWrote {out_json}")
    return results


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--tickers",
        default=",".join(DEFAULT_TICKERS),
        help="Comma-separated tickers",
    )
    p.add_argument("--start", default=DEFAULT_START)
    p.add_argument(
        "--out",
        default="pipeline/research/artifacts/kama_oos_validation.json",
        help="JSON report path",
    )
    args = p.parse_args(argv)
    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    run(tickers, start=args.start, out_json=Path(args.out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
