"""Validate the live trading rules on market history.

Rules are the ones in production. Nothing here is re-tuned on the test window.

  Trend diagnostics   long/flat maps of the deployed forecast (the desk itself
                      does not trade). Signal at the close, earned next bar.
  TEMA                9/99/199 swing, MACD close, long and short.
  Carver              EWMAC 16/64 + 32/128. Long when the blend is >= +5,
                      short when it is <= -5, otherwise flat.
  Watchlist           +4% and 2× volume flip, buy the next open, sell that close.
  LOOP                Donchian 55 + 20-day VWAP, top 8, sector cap 2, on a
                      liquid sleeve. This is the production rule, not the
                      full S&P 500 ∪ Nasdaq-100 universe.
  KAMA                existing 60/40 stability harness on SPY, QQQ, IWM.

Out-of-sample for the calendar rules is every session from 2023-01-01.
Costs for the sleeve books match the paper LOOP model: 10 bps per side.
KAMA keeps the harness it already ships (no cost, ratio split).

Usage:
    PYTHONPATH=/workspace python -m pipeline.research.module_validation
"""
from __future__ import annotations

import json
import subprocess
from dataclasses import asdict
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from pipeline.compute.perps_math import (
    CARVER_CAP,
    CARVER_MIN_ABS,
    CARVER_PRICE_SIGMA_WINDOW,
    EWMAC_FAST_PAIR,
    EWMAC_SLOW_PAIR,
    blended_carver_forecast,
    ema,
)
from pipeline.research.donchian_vwap_backtest import run_donchian_vwap_portfolio
from pipeline.research.kama_backtest import compute_metrics, validate_ticker
from pipeline.research.tema_backtest import tema_position_series
from pipeline.research.watchlist_backtest import simulate_watchlist_trades, summarize

ROOT = Path(__file__).resolve().parents[2]
OOS_START = pd.Timestamp("2023-01-01")
COST_BPS_PER_SIDE = 10.0
HISTORY_START = "2007-01-01"

TREND_ASSETS: list[tuple[str, bool]] = [
    ("SPY", False),
    ("MDY", False),
    ("RSP", False),
    ("IWM", False),
    ("TLT", False),
    ("GLD", False),
    ("DBC", False),
    ("UUP", False),
    ("BTC-USD", True),
]

# Liquid names the LOOP book can actually hold. Sector labels follow GICS.
LOOP_SLEEVE: list[tuple[str, str]] = [
    ("AAPL", "Information Technology"),
    ("MSFT", "Information Technology"),
    ("NVDA", "Information Technology"),
    ("AVGO", "Information Technology"),
    ("AMZN", "Consumer Discretionary"),
    ("TSLA", "Consumer Discretionary"),
    ("HD", "Consumer Discretionary"),
    ("GOOGL", "Communication Services"),
    ("META", "Communication Services"),
    ("JPM", "Financials"),
    ("V", "Financials"),
    ("UNH", "Health Care"),
    ("LLY", "Health Care"),
    ("XOM", "Energy"),
    ("CAT", "Industrials"),
    ("LIN", "Materials"),
]


def carver_forecast_series(close: np.ndarray) -> np.ndarray:
    """Blended EWMAC at each bar. Bar i uses only close[:i+1], same formula as production."""
    x = np.asarray(close, dtype=float)
    n = x.size
    blended = np.zeros(n)
    if n < 2:
        return blended
    changes = pd.Series(np.diff(x))
    sigma = (
        changes.rolling(CARVER_PRICE_SIGMA_WINDOW, min_periods=CARVER_PRICE_SIGMA_WINDOW)
        .std(ddof=0)
        .to_numpy()
    )

    def leg(fast: int, slow: int, scalar: float) -> np.ndarray:
        fast_ema = ema(x, fast)
        slow_ema = ema(x, slow)
        out = np.zeros(n)
        warm = slow + CARVER_PRICE_SIGMA_WINDOW - 1
        for i in range(warm, n):
            sig = sigma[i - 1]
            if not np.isfinite(sig) or sig <= 0:
                continue
            raw = ((fast_ema[i] - slow_ema[i]) / sig) * scalar
            out[i] = float(np.clip(raw, -CARVER_CAP, CARVER_CAP))
        return out

    fast_f = leg(*EWMAC_FAST_PAIR)
    slow_f = leg(*EWMAC_SLOW_PAIR)
    return np.clip(0.5 * (fast_f + slow_f), -CARVER_CAP, CARVER_CAP)


def carver_position(forecast: np.ndarray, long_only: bool) -> np.ndarray:
    f = np.asarray(forecast, dtype=float)
    if long_only:
        return np.where(f >= CARVER_MIN_ABS, 1.0, 0.0)
    return np.where(f >= CARVER_MIN_ABS, 1.0, np.where(f <= -CARVER_MIN_ABS, -1.0, 0.0))


def book_returns(
    frames: dict[str, pd.DataFrame],
    positions: dict[str, pd.Series],
    *,
    cost_bps_per_side: float = COST_BPS_PER_SIDE,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Equal-weight sleeve.

    A position dated t is known at that close and earns the next session.
    Changing a position costs ``cost_bps_per_side`` on that next session.
    Flat slots stay in the average, so unused risk is cash at zero.

    Returns net daily returns, gross daily returns, and the fraction of
    slots that were on (absolute position, lagged).
    """
    rets = pd.DataFrame({sym: frame["close"].astype(float).pct_change() for sym, frame in frames.items()})
    rets = rets.sort_index()
    pos = pd.DataFrame({sym: positions[sym] for sym in frames if sym in positions}).reindex(rets.index)
    pos = pos.fillna(0.0)
    held = pos.shift(1).fillna(0.0)
    contrib = held.mul(rets)
    turn = pos.diff().abs()
    turn.iloc[0] = pos.iloc[0].abs()
    cost = turn.shift(1).fillna(0.0) * (cost_bps_per_side / 10_000.0)
    gross = contrib.mean(axis=1, skipna=True).fillna(0.0)
    net = contrib.sub(cost).mean(axis=1, skipna=True).fillna(0.0)
    exposure = held.abs().mean(axis=1).fillna(0.0)
    gross.name = "gross"
    net.name = "net"
    exposure.name = "exposure"
    return net, gross, exposure


def sample_metrics(returns: pd.Series, exposure: pd.Series | None = None) -> dict:
    r = returns.dropna()
    if r.empty:
        return {"bars": 0}
    pos = None if exposure is None else exposure.reindex(r.index).fillna(0.0).to_numpy()
    metrics = asdict(compute_metrics(r.to_numpy(), position=pos))
    if exposure is not None:
        aligned = exposure.reindex(r.index).fillna(0.0)
        metrics["avg_exposure"] = float(aligned.mean())
    metrics["start"] = str(r.index[0].date())
    metrics["end"] = str(r.index[-1].date())
    return metrics


def split_reports(returns: pd.Series, exposure: pd.Series) -> dict:
    is_mask = returns.index < OOS_START
    oos_mask = returns.index >= OOS_START
    return {
        "full": sample_metrics(returns, exposure),
        "is": sample_metrics(returns.loc[is_mask], exposure.loc[is_mask]),
        "oos": sample_metrics(returns.loc[oos_mask], exposure.loc[oos_mask]),
    }


def _extract_ohlcv(raw: pd.DataFrame, symbol: str) -> pd.DataFrame:
    if isinstance(raw.columns, pd.MultiIndex):
        level0 = set(raw.columns.get_level_values(0))
        if symbol in level0:
            frame = raw[symbol].copy()
        else:
            frame = raw.xs(symbol, axis=1, level=-1).copy()
    else:
        frame = raw.copy()
    frame.columns = [str(col).lower().replace(" ", "_") for col in frame.columns]
    if "adj_close" in frame.columns and "close" not in frame.columns:
        frame = frame.rename(columns={"adj_close": "close"})
    keep = [col for col in ("open", "high", "low", "close", "volume") if col in frame.columns]
    out = frame[keep].apply(pd.to_numeric, errors="coerce").dropna(subset=["close"])
    out = out[~out.index.duplicated(keep="last")].sort_index()
    out.index = pd.to_datetime(out.index).tz_localize(None)
    return out


def download_ohlcv(symbols: list[str], start: str = HISTORY_START) -> dict[str, pd.DataFrame]:
    import yfinance as yf

    raw = yf.download(
        symbols,
        start=start,
        auto_adjust=True,
        progress=False,
        group_by="ticker",
        threads=True,
    )
    if raw is None or raw.empty:
        raise RuntimeError("no market data")
    out: dict[str, pd.DataFrame] = {}
    for symbol in symbols:
        try:
            frame = _extract_ohlcv(raw, symbol)
        except KeyError:
            continue
        if len(frame) >= 260 and {"open", "high", "low", "close"}.issubset(frame.columns):
            out[symbol] = frame
    return out


def export_trend_forecasts(frames: dict[str, pd.DataFrame]) -> dict[str, dict]:
    payload = {
        symbol: {
            "crypto": crypto,
            "close": [float(v) for v in frames[symbol]["close"].tolist()],
        }
        for symbol, crypto in TREND_ASSETS
        if symbol in frames
    }
    work = Path("/tmp/orbis-trend-validation")
    work.mkdir(parents=True, exist_ok=True)
    src = work / "closes.json"
    dst = work / "forecasts.json"
    src.write_text(json.dumps(payload))
    script = ROOT / "scripts" / "exportTrendForecasts.ts"
    subprocess.run(
        ["npx", "vite-node", "--config", str(ROOT / "vitest.config.ts"), str(script), str(src), str(dst)],
        cwd=ROOT,
        check=True,
    )
    forecasts = json.loads(dst.read_text())
    aligned: dict[str, dict] = {}
    for symbol, crypto in TREND_ASSETS:
        if symbol not in frames or symbol not in forecasts:
            continue
        index = frames[symbol].index
        row = forecasts[symbol]
        aligned[symbol] = {
            "combined": pd.Series(row["combined"], index=index, dtype=float),
            "agree": pd.Series(row["agree"], index=index, dtype=object),
            "state": pd.Series(row["state"], index=index, dtype=object),
        }
    return aligned


def on_calendar(frames: dict[str, pd.DataFrame], calendar: pd.DatetimeIndex) -> dict[str, pd.DataFrame]:
    """Sample each close onto the equity calendar. Monday then includes the weekend gap."""
    out: dict[str, pd.DataFrame] = {}
    for symbol, frame in frames.items():
        close = frame["close"].astype(float).sort_index()
        aligned = close.reindex(calendar.union(close.index)).sort_index().ffill(limit=5).reindex(calendar)
        out[symbol] = pd.DataFrame({"close": aligned})
    return out


def asof_series(series: pd.Series, calendar: pd.DatetimeIndex) -> pd.Series:
    ordered = series.sort_index()
    return ordered.reindex(calendar.union(ordered.index)).sort_index().ffill(limit=5).reindex(calendar)


def _positions_from_flags(frames: dict[str, pd.DataFrame], flags: dict[str, pd.Series]) -> dict[str, pd.Series]:
    out: dict[str, pd.Series] = {}
    for symbol, frame in frames.items():
        flag = flags.get(symbol)
        if flag is None:
            out[symbol] = pd.Series(0.0, index=frame.index)
        else:
            out[symbol] = flag.reindex(frame.index).fillna(0.0).astype(float)
    return out


def trend_books(frames: dict[str, pd.DataFrame], forecasts: dict[str, dict]) -> dict[str, dict]:
    calendar = frames["SPY"].index
    held = on_calendar({symbol: frames[symbol] for symbol in forecasts}, calendar)
    combined_flags = {}
    aligned_flags = {}
    up_flags = {}
    for symbol, row in forecasts.items():
        combined = asof_series(row["combined"], calendar)
        agree = asof_series(row["agree"], calendar)
        state = asof_series(row["state"], calendar).astype(str)
        known = combined.notna()
        combined_flags[symbol] = known & (combined > 0)
        aligned_flags[symbol] = known & (combined > 0) & (agree == "3/3")
        up_flags[symbol] = state.str.startswith("Up")
    books = {
        "trend_combined_long": combined_flags,
        "trend_aligned_long": aligned_flags,
        "trend_up_state_long": up_flags,
    }
    reports = {}
    for name, flags in books.items():
        pos = _positions_from_flags(held, flags)
        net, gross, exposure = book_returns(held, pos)
        flat = _positions_from_flags(held, {symbol: pd.Series(1.0, index=frame.index) for symbol, frame in held.items()})
        bh_net, _, bh_exposure = book_returns(held, flat, cost_bps_per_side=0.0)
        reports[name] = {
            "rule": _TREND_RULES[name],
            "net": split_reports(net, exposure),
            "gross": split_reports(gross, exposure),
            "buy_hold": split_reports(bh_net, bh_exposure),
        }
    per_asset = []
    for symbol, row in forecasts.items():
        flag = combined_flags[symbol].astype(float)
        one = {symbol: held[symbol]}
        net, _, exposure = book_returns(one, {symbol: flag})
        bh, _, bh_exp = book_returns(one, {symbol: pd.Series(1.0, index=held[symbol].index)}, cost_bps_per_side=0.0)
        per_asset.append(
            {
                "symbol": symbol,
                "oos_sharpe": split_reports(net, exposure)["oos"].get("sharpe"),
                "oos_buyhold_sharpe": split_reports(bh, bh_exp)["oos"].get("sharpe"),
                "oos_cagr": split_reports(net, exposure)["oos"].get("cagr"),
                "oos_max_drawdown": split_reports(net, exposure)["oos"].get("max_drawdown"),
            }
        )
    reports["per_asset_combined_long_oos"] = per_asset
    return reports


_TREND_RULES = {
    "trend_combined_long": "Long the asset when Combined > 0, otherwise flat. Equal-weight the nine sleeves.",
    "trend_aligned_long": "Long only when Combined > 0 and Agree is 3/3.",
    "trend_up_state_long": "Long when the state starts with Up (building, steady, or fading).",
}


def tema_book(frames: dict[str, pd.DataFrame]) -> dict:
    calendar = frames["SPY"].index
    held = on_calendar(frames, calendar)
    positions = {}
    long_only = {}
    for symbol, frame in frames.items():
        close = frame["close"].to_numpy(dtype=float)
        pos = asof_series(pd.Series(tema_position_series(close), index=frame.index), calendar).fillna(0.0)
        positions[symbol] = pos
        long_only[symbol] = pos.clip(lower=0.0)
    net, gross, exposure = book_returns(held, positions)
    net_long, _, exp_long = book_returns(held, long_only)
    bh, _, bh_exp = book_returns(
        held,
        {symbol: pd.Series(1.0, index=calendar) for symbol in held},
        cost_bps_per_side=0.0,
    )
    return {
        "rule": "TEMA 9 > 99 while close is above TEMA 199 (short is the inverse). Flat on MACD close.",
        "long_short": {"net": split_reports(net, exposure), "gross": split_reports(gross, exposure)},
        "long_only": split_reports(net_long, exp_long),
        "buy_hold": split_reports(bh, bh_exp),
    }


def carver_book(frames: dict[str, pd.DataFrame]) -> dict:
    calendar = frames["SPY"].index
    held = on_calendar(frames, calendar)
    signed = {}
    long_only = {}
    for symbol, frame in frames.items():
        forecast = carver_forecast_series(frame["close"].to_numpy(dtype=float))
        native = pd.Series(carver_position(forecast, long_only=False), index=frame.index)
        signed[symbol] = asof_series(native, calendar).fillna(0.0)
        long_native = pd.Series(carver_position(forecast, long_only=True), index=frame.index)
        long_only[symbol] = asof_series(long_native, calendar).fillna(0.0)
    net, gross, exposure = book_returns(held, signed)
    net_long, _, exp_long = book_returns(held, long_only)
    bh, _, bh_exp = book_returns(
        held,
        {symbol: pd.Series(1.0, index=calendar) for symbol in held},
        cost_bps_per_side=0.0,
    )
    return {
        "rule": "Blend EWMAC 16/64 (scalar 3.75) and 32/128 (scalar 2.65). Trade when |forecast| >= 5.",
        "long_short": {"net": split_reports(net, exposure), "gross": split_reports(gross, exposure)},
        "long_only": split_reports(net_long, exp_long),
        "buy_hold": split_reports(bh, bh_exp),
    }


def watchlist_report(frames: dict[str, pd.DataFrame]) -> dict:
    trades = []
    for symbol, frame in frames.items():
        # build_watchlist_history renames a nameless index to "date".
        cleaned = frame.copy()
        cleaned.index.name = None
        trades.extend(simulate_watchlist_trades(symbol, cleaned))
    is_trades = [t for t in trades if t.entry_date < "2023-01-01"]
    oos_trades = [t for t in trades if t.entry_date >= "2023-01-01"]
    return {
        "rule": "On-list flip at the close (+4% day and 2× 50-day volume). Buy the next open, sell that close.",
        "universe": sorted(frames),
        "is": summarize(is_trades),
        "oos": summarize(oos_trades),
        "full": summarize(trades),
    }


def loop_report(frames: dict[str, pd.DataFrame], sectors: dict[str, str]) -> dict:
    from pipeline.compute.donchian_vwap import donchian_frame

    signals = {}
    panels = {}
    for symbol, frame in frames.items():
        panels[symbol] = frame
        if symbol == "SPY":
            continue
        if len(frame) < 80:
            continue
        signals[symbol] = donchian_frame(frame)
    if "SPY" not in panels or not signals:
        return {"error": "LOOP sleeve missing SPY or signals"}
    end = max(frame.index.max() for frame in panels.values()).date()
    daily, _eq = run_donchian_vwap_portfolio(
        date(2018, 1, 1),
        end,
        panels=panels,
        signals=signals,
        sym_sector=sectors,
        exit_mode="donchian20",
    )
    daily.index = pd.to_datetime(daily.index)
    exposure = pd.Series(np.where(daily.to_numpy() != 0, 1.0, 0.0), index=daily.index)
    spy = panels["SPY"]["close"].astype(float).pct_change().dropna()
    spy_exp = pd.Series(1.0, index=spy.index)
    return {
        "rule": "Close above the prior 55-day high and above 20-day VWAP. Exit on the prior 20-day low. Top 8, max 2 per sector, rebalance every 5 sessions. Costs are the LOOP model.",
        "universe": "Liquid 16-name sleeve, not the full S&P 500 ∪ Nasdaq-100 book.",
        "names": sorted(signals),
        "net": split_reports(daily, exposure),
        "spy_buy_hold": split_reports(spy, spy_exp),
    }


def kama_report(frames: dict[str, pd.DataFrame]) -> dict:
    rows = []
    for symbol in ("SPY", "QQQ", "IWM"):
        if symbol not in frames:
            continue
        close = frames[symbol]["close"].astype(float).dropna()
        close.name = symbol
        result = validate_ticker(symbol, close)
        rows.append(
            {
                "ticker": symbol,
                "train": f"{result.train_start} → {result.train_end}",
                "test": f"{result.test_start} → {result.test_end}",
                "n_qualified": result.n_qualified,
                "production_cross_oos_sharpe": result.metrics["production_cross_oos"]["sharpe"],
                "production_regime_oos_sharpe": result.metrics["production_regime_oos"]["sharpe"],
                "buyhold_oos_sharpe": result.metrics["buyhold_oos"]["sharpe"],
                "stable_cross_oos_sharpe": (result.metrics.get("stable_cross_oos") or {}).get("sharpe"),
                "stable_params": result.stable_params,
            }
        )
    return {
        "rule": "Dual-KAMA. Production cross is short KAMA above long KAMA. Regime is close above the long KAMA. Split is 60/40 of each series, not the 2023 calendar cut. No costs in this harness.",
        "rows": rows,
    }


def _round(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {k: _round(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_round(v) for v in value]
    return value


def run() -> dict:
    symbols = sorted({s for s, _ in TREND_ASSETS} | {s for s, _ in LOOP_SLEEVE} | {"QQQ", "SPY"})
    frames = download_ohlcv(symbols)
    trend_frames = {s: frames[s] for s, _ in TREND_ASSETS if s in frames}
    forecasts = export_trend_forecasts(trend_frames)
    loop_frames = {s: frames[s] for s, _ in LOOP_SLEEVE if s in frames}
    loop_frames["SPY"] = frames["SPY"]
    report = {
        "oos_start": "2023-01-01",
        "cost_bps_per_side": COST_BPS_PER_SIDE,
        "history_start": HISTORY_START,
        "as_of": str(max(frame.index.max() for frame in frames.values()).date()),
        "missing": sorted(set(symbols) - set(frames)),
        "trend": trend_books(trend_frames, forecasts),
        "tema": tema_book(trend_frames),
        "carver": carver_book(trend_frames),
        "watchlist": watchlist_report({s: frames[s] for s, _ in LOOP_SLEEVE if s in frames}),
        "loop": loop_report(loop_frames, {s: sec for s, sec in LOOP_SLEEVE}),
        "kama": kama_report(frames),
    }
    return _round(report)


def main() -> None:
    report = run()
    out = ROOT / "pipeline" / "research" / "artifacts" / "module_validation.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2))
    print(f"wrote {out}")
    print(f"as of {report['as_of']}  OOS from {report['oos_start']}  cost {report['cost_bps_per_side']} bps/side")

    def line(name: str, block: dict, bh: dict | None = None) -> None:
        oos = block.get("oos") or {}
        bh_oos = (bh or {}).get("oos") or {}
        print(
            f"{name:<28} sharpe {oos.get('sharpe', float('nan')):7.2f}  "
            f"cagr {oos.get('cagr', float('nan')):7.1%}  "
            f"maxDD {oos.get('max_drawdown', float('nan')):7.1%}  "
            f"exposure {oos.get('avg_exposure', float('nan')):5.0%}  "
            f"bh {bh_oos.get('sharpe', float('nan')):5.2f}"
        )

    print("\nOOS net, nine-asset sleeves")
    for key in ("trend_combined_long", "trend_aligned_long", "trend_up_state_long"):
        row = report["trend"][key]
        line(key, row["net"], row["buy_hold"])
    line("tema long/short", report["tema"]["long_short"]["net"], report["tema"]["buy_hold"])
    line("tema long only", report["tema"]["long_only"], report["tema"]["buy_hold"])
    line("carver long/short", report["carver"]["long_short"]["net"], report["carver"]["buy_hold"])
    line("carver long only", report["carver"]["long_only"], report["carver"]["buy_hold"])
    print("\nLOOP liquid sleeve vs SPY")
    line("donchian+vwap", report["loop"]["net"], report["loop"]["spy_buy_hold"])
    print("\nWatchlist one-day follow-through")
    for label in ("is", "oos", "full"):
        row = report["watchlist"][label]
        print(
            f"  {label:<6} n={row['n_trades']:<4} win {row['win_rate_pct']:5.1f}%  "
            f"avg {row['avg_return_pct']:+6.3f}%  median {row['median_return_pct']:+6.3f}%"
        )
    print("\nKAMA 60/40 OOS Sharpe")
    for row in report["kama"]["rows"]:
        print(
            f"  {row['ticker']:<6} cross {row['production_cross_oos_sharpe']:5.2f}  "
            f"regime {row['production_regime_oos_sharpe']:5.2f}  "
            f"bh {row['buyhold_oos_sharpe']:5.2f}  test {row['test']}"
        )


if __name__ == "__main__":
    main()
