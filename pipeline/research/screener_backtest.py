"""Backtest Trend Radar *screener* rules (not LOOP Donchian) for a calendar window.

Simulates a screener-aligned book:
  - Universe: LOOP-tradable US index names (ex-pharma)
  - Eligible: state GREEN, quality_rank >= MIN_RANK, z_mom > 0, f_ewmac > 0
  - Portfolio: top TOP_N by rank (+ convergence), equal weight, rebalance every 5 sessions
  - Exit between rebalances: leave GREEN or rank < MIN_RANK

Usage:
    python -m pipeline.research.screener_backtest --start 2026-01-01 --end 2026-09-26
"""
from __future__ import annotations

import argparse
from datetime import date

import numpy as np
import pandas as pd
import yfinance as yf

from pipeline.compute.trend_radar_legacy import MIN_HISTORY_DAYS
from pipeline.ingest.us_index_universe import build_merged_universe
from pipeline.research.loop_backtest import _bar_on, _download_panel
from pipeline.research.radar_alert_backtest import build_radar_history
from pipeline.universe_filters import is_loop_tradable, is_pharma_stock

MIN_RANK = 60
TOP_N = 8
MAX_PER_SECTOR = 2
REBALANCE_DAYS = 5
EQUITY = 100_000.0
LOOKBACK = "2024-08-01"


def _universe_sectors() -> dict[str, str]:
    stocks, _ = build_merged_universe()
    return {
        s["symbol"]: s.get("sector") or "Unknown"
        for s in stocks
        if is_loop_tradable({**s, "is_active": not is_pharma_stock(s)})
    }


def _radar_row(hist: pd.DataFrame, d: date) -> pd.Series | None:
    idx = hist.index
    if getattr(idx, "tz", None) is not None:
        hist = hist.copy()
        hist.index = idx.tz_localize(None)
    hits = hist.index.normalize() == pd.Timestamp(d)
    if not hits.any():
        return None
    return hist.loc[hits].iloc[0]


def run_screener_portfolio(start: date, end: date) -> tuple[pd.Series, dict]:
    sectors = _universe_sectors()
    symbols = sorted(sectors.keys())
    panels = _download_panel(symbols, LOOKBACK)
    radar: dict[str, pd.DataFrame] = {}
    for sym, ohlcv in panels.items():
        if len(ohlcv) >= MIN_HISTORY_DAYS + 5:
            try:
                radar[sym] = build_radar_history(ohlcv)
            except Exception:
                pass

    if "SPY" not in panels:
        spy = yf.download("SPY", start=LOOKBACK, progress=False, auto_adjust=True)
        panels["SPY"] = spy.rename(columns=str.lower)[["open", "high", "low", "close", "volume"]].dropna()

    days = [
        d.date() if hasattr(d, "date") else d
        for d in panels["SPY"].index
        if start <= (d.date() if hasattr(d, "date") else d) <= end
    ]

    holdings: list[str] = []
    daily_rets: list[float] = []
    exits = {"left_green": 0, "rank_decay": 0, "rebalance_out": 0}

    for i, d in enumerate(days):
        signal_day = days[max(0, i - 1)]

        # intraweek screener exits
        still = []
        for sym in holdings:
            row = _radar_row(radar[sym], d) if sym in radar else None
            if row is None:
                still.append(sym)
                continue
            st = int(row["state"])
            rank = int(row["quality_rank"])
            if st != 1:
                exits["left_green"] += 1
                continue
            if rank < MIN_RANK:
                exits["rank_decay"] += 1
                continue
            still.append(sym)
        holdings = still

        if i % REBALANCE_DAYS == 0 or not holdings:
            from collections import defaultdict

            sector_count: dict[str, int] = defaultdict(int)
            cands: list[tuple[str, int, int]] = []
            for sym, hist in radar.items():
                row = _radar_row(hist, signal_day)
                if row is None:
                    continue
                if int(row["state"]) != 1:
                    continue
                rank = int(row["quality_rank"])
                if rank < MIN_RANK:
                    continue
                if float(row["z_mom"]) <= 0 or float(row["f_ewmac"]) <= 0:
                    continue
                conv = int(row["convergence"])
                cands.append((sym, rank, conv))
            cands.sort(key=lambda x: (-x[1], -x[2]))
            target: list[str] = []
            for sym, _, _ in cands:
                sec = sectors.get(sym, "Unknown")
                if sector_count[sec] >= MAX_PER_SECTOR:
                    continue
                target.append(sym)
                sector_count[sec] += 1
                if len(target) >= TOP_N:
                    break
            for sym in holdings:
                if sym not in target:
                    exits["rebalance_out"] += 1
            holdings = target

        parts = []
        for sym in holdings:
            bar = _bar_on(panels[sym], d)
            if bar is None:
                continue
            ohlcv = panels[sym]
            ts = pd.Timestamp(d)
            loc = int(np.where(ohlcv.index.normalize() == ts)[0][0])
            if loc == 0:
                continue
            parts.append(
                float(ohlcv.iloc[loc]["close"]) / float(ohlcv.iloc[loc - 1]["close"]) - 1
            )
        daily_rets.append(float(np.mean(parts)) if parts else 0.0)

    s = pd.Series(daily_rets, index=pd.to_datetime(days))
    eq = (1 + s).cumprod()
    dd = (eq / eq.cummax() - 1).min() * 100
    stats = {
        "total_return_pct": (eq.iloc[-1] - 1) * 100 if len(eq) else 0,
        "max_drawdown_pct": float(dd),
        "sharpe": float(s.mean() / s.std() * np.sqrt(252)) if s.std() > 0 else 0,
        "exit_counts": exits,
    }
    return s, stats


def _bench(start: date, end: date, ticker: str) -> float:
    h = yf.Ticker(ticker).history(start=start.isoformat(), end=end.isoformat(), auto_adjust=True)
    if len(h) < 2:
        return float("nan")
    return (float(h["Close"].iloc[-1]) / float(h["Close"].iloc[0]) - 1) * 100


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--start", default="2026-01-01")
    p.add_argument("--end", default="2026-09-26")
    args = p.parse_args()
    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)

    rets, stats = run_screener_portfolio(start, end)
    spy = _bench(start, end, "SPY")
    qqq = _bench(start, end, "QQQ")

    print("=== Trend Radar SCREENER backtest (2026-style rules) ===")
    print(f"Window: {start} → {end}")
    print(f"Rules: GREEN, rank>={MIN_RANK}, z_mom>0, f_ewmac>0, top {TOP_N}, rebalance {REBALANCE_DAYS}d")
    print(f"Return: {stats['total_return_pct']:+.2f}%  MaxDD: {stats['max_drawdown_pct']:.2f}%  Sharpe: {stats['sharpe']:.2f}")
    print(f"Exits: {stats['exit_counts']}")
    print(f"SPY: {spy:+.2f}%  QQQ: {qqq:+.2f}%")
    good = stats["total_return_pct"] >= spy and stats["total_return_pct"] > 0
    print(f"Verdict vs SPY: {'GOOD' if good else 'WEAK'} (screener basket {'beats' if stats['total_return_pct'] >= spy else 'lags'} SPY)")


if __name__ == "__main__":
    main()
