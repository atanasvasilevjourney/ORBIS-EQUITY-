"""EMA200 touch bounce — event study + long-only walk-forward backtest.

Research harness (not nightly pipeline). Mirrors TEMA/KAMA IS/OOS splits:
  - Event study with forward returns, MAE/MFE
  - Baselines: random days, EMA150/250, buy-and-hold drift
  - Param grid + neighborhood stability on OOS Sharpe
  - Monte Carlo bootstrap on trade returns

Usage:
    PYTHONPATH=/workspace python -m pipeline.research.ema200_backtest
    PYTHONPATH=/workspace python -m pipeline.research.ema200_backtest --tickers AMZN,SPY,AAPL
"""
from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass, replace
from pathlib import Path

import numpy as np
import pandas as pd

from pipeline.compute.param_stability import score_candidates
from pipeline.ema200_scanner.config.loader import load_config
from pipeline.ema200_scanner.signals.ema200_touch import TouchParams, detect_events, events_only
from pipeline.research.kama_backtest import BARS_PER_YEAR, compute_metrics

TRAIN_RATIO = 0.60
DEFAULT_TICKERS = ("AMZN", "AAPL", "MSFT", "SPY", "QQQ", "NVDA")
DEFAULT_START = "2018-01-01"
HOLD_BARS = 20
STOP_ATR_MULT = 2.0


@dataclass(frozen=True)
class Trade:
    entry_date: str
    exit_date: str
    entry_price: float
    exit_price: float
    return_pct: float
    bars_held: int
    exit_reason: str


def default_param_grid() -> list[TouchParams]:
    grid: list[TouchParams] = []
    for ema_p in (150, 200, 250):
        for min_days in (15, 20, 30):
            for tol in (0.15, 0.25, 0.35):
                for slope in (0.0, 0.0002):
                    grid.append(
                        TouchParams(
                            ema_period=ema_p,
                            min_days_above=min_days,
                            touch_tolerance_atr=tol,
                            min_slope=slope,
                        )
                    )
    return grid


def cfg_touch_params(cfg: dict | None = None) -> TouchParams:
    cfg = cfg or load_config()
    t = cfg["trend"]
    touch = cfg["touch"]
    return TouchParams(
        ema_period=int(cfg["ema_period"]),
        atr_period=int(cfg["atr_period"]),
        history_min_bars=int(cfg["history_min_bars"]),
        slope_lookback=int(t["slope_lookback"]),
        min_days_above=int(t["min_days_above"]),
        min_slope=float(t["min_slope"]),
        touch_tolerance_atr=float(touch["touch_tolerance_atr"]),
    )


def download_ohlcv(ticker: str, start: str) -> pd.DataFrame:
    import yfinance as yf

    data = yf.download(ticker, start=start, progress=False, auto_adjust=True)
    if data.empty:
        raise RuntimeError(f"No data for {ticker}")
    if isinstance(data.columns, pd.MultiIndex):
        data = data.droplevel(1, axis=1)
    return pd.DataFrame(
        {
            "open": data["Open"].astype(float),
            "high": data["High"].astype(float),
            "low": data["Low"].astype(float),
            "close": data["Close"].astype(float),
            "volume": data["Volume"].astype(float),
        }
    ).dropna(subset=["close"])


def download_close(ticker: str, start: str) -> pd.Series:
    return download_ohlcv(ticker, start)["close"]


def ohlcv_from_close(close: pd.Series, *, vol: float = 1e6) -> pd.DataFrame:
    c = close.astype(float)
    return pd.DataFrame(
        {
            "open": c,
            "high": c * 1.005,
            "low": c * 0.995,
            "close": c,
            "volume": vol,
        },
        index=c.index,
    )


def benchmark_regime(spy_close: pd.Series, ema_period: int, history_min: int) -> pd.Series:
    from pipeline.ema200_scanner.indicators.features import compute_regime

    return compute_regime(spy_close.astype(float), ema_period, history_min)


def forward_stats(close: pd.Series, event_idx: pd.Index, horizons: tuple[int, ...] = (1, 5, 10, 20)) -> pd.DataFrame:
    rows = []
    c = close.astype(float)
    for dt in event_idx:
        if dt not in c.index:
            continue
        i = c.index.get_loc(dt)
        px0 = float(c.iloc[i])
        if px0 <= 0:
            continue
        row = {"date": dt.strftime("%Y-%m-%d") if hasattr(dt, "strftime") else str(dt)[:10]}
        for h in horizons:
            j = i + h
            if j < len(c):
                row[f"fwd_ret_{h}d"] = float(c.iloc[j] / px0 - 1.0)
            else:
                row[f"fwd_ret_{h}d"] = np.nan
        # MAE/MFE over 20d
        window = c.iloc[i + 1 : i + 21]
        if len(window):
            rel = window / px0 - 1.0
            row["mae_20d"] = float(rel.min())
            row["mfe_20d"] = float(rel.max())
        rows.append(row)
    return pd.DataFrame(rows)


def random_baseline(
    close: pd.Series,
    regime: pd.Series,
    n_events: int,
    *,
    seed: int = 0,
) -> pd.DataFrame:
    """Random entry days with same bull/bear mix as benchmark regime series."""
    if n_events <= 0 or len(close) < 50:
        return pd.DataFrame()
    rng = np.random.default_rng(seed)
    eligible = close.index[50:-21]
    if len(eligible) == 0:
        return pd.DataFrame()
    reg = regime.reindex(eligible).ffill()
    bull_idx = eligible[reg == "bull"]
    bear_idx = eligible[reg == "bear"]
    n_bull = int(round(n_events * len(bull_idx) / max(len(eligible), 1)))
    n_bear = n_events - n_bull
    picks = []
    if len(bull_idx) and n_bull:
        picks.extend(rng.choice(bull_idx, size=min(n_bull, len(bull_idx)), replace=False))
    if len(bear_idx) and n_bear:
        picks.extend(rng.choice(bear_idx, size=min(n_bear, len(bear_idx)), replace=False))
    if len(picks) < n_events:
        extra = rng.choice(eligible, size=n_events - len(picks), replace=False)
        picks.extend(extra)
    idx = pd.Index(picks)
    return forward_stats(close, idx)


def simulate_long_touch(
    ohlcv: pd.DataFrame,
    events: pd.DataFrame,
    *,
    hold_bars: int = HOLD_BARS,
    stop_atr_mult: float = STOP_ATR_MULT,
    cooldown_bars: int = 10,
) -> tuple[list[Trade], np.ndarray]:
    """Long at bounce close; exit on stop (low), time, or close < EMA200."""
    close = ohlcv["close"].astype(float).to_numpy()
    low = ohlcv["low"].astype(float).to_numpy()
    ema = events["ema200"].astype(float).to_numpy()
    atr = events["atr14"].astype(float).to_numpy()
    signal = events["is_touch_bounce"].to_numpy(dtype=bool)
    n = len(close)
    pos = np.zeros(n)
    trades: list[Trade] = []
    in_trade = False
    entry_i = 0
    entry_px = 0.0
    stop = 0.0
    cooldown_until = 0

    index = ohlcv.index

    for i in range(n):
        if in_trade:
            reason = None
            if low[i] <= stop:
                reason = "atr_stop"
            elif i - entry_i >= hold_bars:
                reason = "time_exit"
            elif close[i] < ema[i]:
                reason = "ema_break"
            if reason:
                exit_px = close[i]
                ret = exit_px / entry_px - 1.0
                trades.append(
                    Trade(
                        entry_date=str(index[entry_i])[:10],
                        exit_date=str(index[i])[:10],
                        entry_price=entry_px,
                        exit_price=exit_px,
                        return_pct=ret,
                        bars_held=i - entry_i,
                        exit_reason=reason,
                    )
                )
                in_trade = False
                cooldown_until = i + cooldown_bars
        if not in_trade and i > cooldown_until and signal[i]:
            in_trade = True
            entry_i = i
            entry_px = close[i]
            a = atr[i] if np.isfinite(atr[i]) and atr[i] > 0 else entry_px * 0.02
            stop = entry_px - stop_atr_mult * a
        pos[i] = 1.0 if in_trade else 0.0

    rets = np.zeros(n - 1)
    for i in range(n - 1):
        if pos[i] > 0 and close[i] > 0:
            rets[i] = close[i + 1] / close[i] - 1.0
    return trades, rets


def metrics_from_trades(trades: list[Trade]) -> dict:
    if not trades:
        return {"n_trades": 0, "hit_rate": 0.0, "mean_return": 0.0, "median_return": 0.0}
    r = np.array([t.return_pct for t in trades], dtype=float)
    return {
        "n_trades": len(trades),
        "hit_rate": float((r > 0).mean()),
        "mean_return": float(r.mean()),
        "median_return": float(np.median(r)),
    }


def monte_carlo_trades(trades: list[Trade], *, n_sims: int = 2000, seed: int = 42) -> dict:
    if not trades:
        return {"n_sims": 0, "mean_return_p5": 0.0, "mean_return_p50": 0.0, "mean_return_p95": 0.0}
    r = np.array([t.return_pct for t in trades], dtype=float)
    rng = np.random.default_rng(seed)
    sim_means = []
    for _ in range(n_sims):
        sample = rng.choice(r, size=len(r), replace=True)
        sim_means.append(float(sample.mean()))
    arr = np.array(sim_means)
    return {
        "n_sims": n_sims,
        "mean_return_p5": float(np.percentile(arr, 5)),
        "mean_return_p50": float(np.percentile(arr, 50)),
        "mean_return_p95": float(np.percentile(arr, 95)),
    }


def split_close(close: pd.Series, ratio: float = TRAIN_RATIO) -> tuple[pd.Series, pd.Series]:
    idx = int(len(close) * ratio)
    return close.iloc[:idx], close.iloc[idx:]


@dataclass(frozen=True)
class TickerResult:
    ticker: str
    n_bars: int
    n_events: int
    production_params: dict
    stable_params: dict | None
    event_stats: dict
    baselines: dict
    metrics: dict
    monte_carlo: dict


def analyze_ticker(
    ticker: str,
    ohlcv: pd.DataFrame,
    spy_regime: pd.Series,
    *,
    grid: list[TouchParams] | None = None,
) -> TickerResult:
    close = ohlcv["close"]
    prod = cfg_touch_params()
    ev_prod = detect_events(ohlcv, prod, regime_series=spy_regime)
    bounces = events_only(ev_prod, "TOUCH_BOUNCE")
    fwd = forward_stats(close, bounces.index)
    n_ev = len(bounces)

    baselines: dict = {}
    baselines["random"] = {}
    if n_ev:
        rnd = random_baseline(close, spy_regime, n_ev)
        for col in [c for c in fwd.columns if c.startswith("fwd_ret_")]:
            baselines["random"][col] = float(rnd[col].mean()) if col in rnd else None

    for ema_p in (150, 250):
        p = replace(prod, ema_period=ema_p)
        ev_alt = detect_events(ohlcv, p, regime_series=spy_regime)
        alt = events_only(ev_alt, "TOUCH_BOUNCE")
        alt_fwd = forward_stats(close, alt.index)
        key = f"ema{ema_p}"
        baselines[key] = {
            "n_events": len(alt),
            "fwd_ret_5d_mean": float(alt_fwd["fwd_ret_5d"].mean()) if len(alt_fwd) else None,
        }

    event_stats = {
        "n_touch_bounce": n_ev,
        "fwd_ret_1d_mean": float(fwd["fwd_ret_1d"].mean()) if len(fwd) else None,
        "fwd_ret_5d_mean": float(fwd["fwd_ret_5d"].mean()) if len(fwd) else None,
        "fwd_ret_10d_mean": float(fwd["fwd_ret_10d"].mean()) if len(fwd) else None,
        "fwd_ret_20d_mean": float(fwd["fwd_ret_20d"].mean()) if len(fwd) else None,
        "mae_20d_mean": float(fwd["mae_20d"].mean()) if len(fwd) else None,
        "mfe_20d_mean": float(fwd["mfe_20d"].mean()) if len(fwd) else None,
    }

    train, test = split_close(close)
    grid = grid or default_param_grid()
    is_sharpes: list[float] = []
    oos_sharpes: list[float] = []
    param_dicts: list[dict] = []

    for p in grid:
        param_dicts.append(asdict(p))
        ohlcv_full = ohlcv_from_close(close)
        ev = detect_events(ohlcv_full, p, regime_series=spy_regime)
        _, strat_rets = simulate_long_touch(ohlcv_full, ev)
        ohlcv_tr = ohlcv_from_close(train)
        ev_tr = detect_events(ohlcv_tr, p, regime_series=spy_regime.reindex(train.index).ffill())
        _, strat_is = simulate_long_touch(ohlcv_tr, ev_tr)
        ohlcv_te = ohlcv_from_close(test)
        ev_te = detect_events(ohlcv_te, p, regime_series=spy_regime.reindex(test.index).ffill())
        _, strat_oos = simulate_long_touch(ohlcv_te, ev_te)
        is_sharpes.append(compute_metrics(strat_is).sharpe)
        oos_sharpes.append(compute_metrics(strat_oos).sharpe)

    selection = score_candidates(param_dicts, is_sharpes, oos_sharpes, is_sharpe_floor=0.0)
    stable = selection.best.params if selection.best else None

    _, strat_prod = simulate_long_touch(ohlcv, ev_prod)
    trades, _ = simulate_long_touch(ohlcv, ev_prod)
    idx = int(len(close) * TRAIN_RATIO)
    metrics = {
        "full": asdict(compute_metrics(strat_prod)),
        "is": asdict(compute_metrics(strat_prod[: max(idx - 1, 0)])),
        "oos": asdict(compute_metrics(strat_prod[idx - 1 :])),
        "buyhold": asdict(compute_metrics(close.pct_change().fillna(0).to_numpy()[1:])),
        "trade_summary": metrics_from_trades(trades),
    }

    return TickerResult(
        ticker=ticker,
        n_bars=len(close),
        n_events=n_ev,
        production_params=asdict(prod),
        stable_params=stable,
        event_stats=event_stats,
        baselines=baselines,
        metrics=metrics,
        monte_carlo=monte_carlo_trades(trades),
    )


def run_batch(tickers: tuple[str, ...], start: str = DEFAULT_START) -> list[TickerResult]:
    spy = download_close("SPY", start)
    cfg = load_config()
    regime = benchmark_regime(spy, int(cfg["ema_period"]), int(cfg["history_min_bars"]))
    results = []
    for t in tickers:
        try:
            ohlcv = download_ohlcv(t, start)
            results.append(analyze_ticker(t, ohlcv, regime))
        except Exception as exc:
            print(f"SKIP {t}: {exc}")
    return results


def write_report(results: list[TickerResult], path: Path) -> None:
    lines = ["# EMA200 touch — event study & walk-forward report", ""]
    for r in results:
        lines.append(f"## {r.ticker} ({r.n_bars} bars, {r.n_events} touch events)")
        lines.append("")
        lines.append("### Event study (production params, TOUCH_BOUNCE)")
        for k, v in r.event_stats.items():
            lines.append(f"- **{k}**: {v}")
        lines.append("")
        lines.append("### Baselines")
        lines.append(f"```json\n{json.dumps(r.baselines, indent=2)}\n```")
        lines.append("")
        lines.append("### Strategy metrics (long simulation)")
        lines.append(f"- IS Sharpe: {r.metrics['is']['sharpe']:.3f}")
        lines.append(f"- OOS Sharpe: {r.metrics['oos']['sharpe']:.3f}")
        lines.append(f"- Full Sharpe: {r.metrics['full']['sharpe']:.3f}")
        lines.append(f"- Buy&hold Sharpe: {r.metrics['buyhold']['sharpe']:.3f}")
        lines.append(f"- Trades: {r.metrics['trade_summary']}")
        lines.append("")
        lines.append("### Monte Carlo (trade mean return)")
        lines.append(f"```json\n{json.dumps(r.monte_carlo, indent=2)}\n```")
        if r.stable_params:
            lines.append(f"\n**Stability-selected params:** `{r.stable_params}`")
        lines.append("")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tickers", default=",".join(DEFAULT_TICKERS))
    parser.add_argument("--start", default=DEFAULT_START)
    parser.add_argument(
        "--report",
        default="pipeline/research/report.md",
    )
    args = parser.parse_args()
    tickers = tuple(x.strip() for x in args.tickers.split(",") if x.strip())
    results = run_batch(tickers, args.start)
    write_report(results, Path(args.report))
    for r in results:
        print(
            r.ticker,
            "events=",
            r.n_events,
            "OOS Sharpe",
            round(r.metrics["oos"]["sharpe"], 3),
            "5d fwd",
            r.event_stats.get("fwd_ret_5d_mean"),
        )


if __name__ == "__main__":
    main()
