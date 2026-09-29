"""Backtest Module 1 — production momentum watchlist (`trend_radar.process_ticker`).

This validates the *live* screener rules (+4% / 2× vol on list, +10% / 5× hot),
not `trend_radar_legacy` GREEN/EWMAC states.

Signal timing (EOD desk):
  - At close of day *t*, run `process_ticker` on history through *t*.
  - **ON_LIST_FLIP** when `state` becomes 1 after not being 1 on *t−1*.
  - Fill at **open** of *t+1*; exit at **close** of *t+1* (one-session follow-through).

Usage:
  PYTHONPATH=/workspace python -m pipeline.research.watchlist_backtest
  PYTHONPATH=/workspace python -m pipeline.research.watchlist_backtest --tickers AAPL,MSFT
"""
from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from pipeline.compute.trend_radar import MIN_HISTORY_DAYS, process_ticker


@dataclass
class WatchlistTrade:
    symbol: str
    signal_date: str
    entry_date: str
    exit_date: str
    entry_price: float
    exit_price: float
    return_pct: float
    day_pct: float
    rel_vol: float
    entry_timing: str


def _normalize_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    if not isinstance(out.index, pd.DatetimeIndex):
        if "date" in out.columns:
            out = out.set_index("date")
        else:
            raise ValueError("OHLCV needs DatetimeIndex or date column")
    out.index = pd.to_datetime(out.index)
    out = out.sort_index()
    for col in ("open", "high", "low", "close", "volume"):
        if col not in out.columns:
            raise ValueError(f"missing column {col}")
    return out


def build_watchlist_history(df: pd.DataFrame) -> pd.DataFrame:
    """Daily watchlist state from production `process_ticker` (no lookahead)."""
    df = _normalize_ohlcv(df)
    rows: list[dict] = []
    prev_state: int | None = None

    for i in range(MIN_HISTORY_DAYS - 1, len(df)):
        window = df.iloc[: i + 1].reset_index()
        window = window.rename(columns={"index": "date"})
        sig = process_ticker(window)
        if sig is None:
            continue
        state = int(sig["state"])
        flip_on = state == 1 and prev_state is not None and prev_state != 1
        rows.append(
            {
                "date": df.index[i],
                "state": state,
                "on_list_flip": flip_on,
                "day_pct": sig["z_mom"],
                "rel_vol": sig["f_ewmac"],
                "entry_timing": sig["entry_timing"],
                "quality_rank": sig["quality_rank"],
            }
        )
        prev_state = state

    return pd.DataFrame(rows).set_index("date")


def simulate_watchlist_trades(symbol: str, df: pd.DataFrame) -> list[WatchlistTrade]:
    """One-day hold after an on-list flip; entries at next open."""
    df = _normalize_ohlcv(df)
    hist = build_watchlist_history(df)
    trades: list[WatchlistTrade] = []

    for signal_date, row in hist[hist["on_list_flip"]].iterrows():
        loc = df.index.get_loc(signal_date)
        if isinstance(loc, slice):
            continue
        if loc + 1 >= len(df):
            continue
        nxt = df.iloc[loc + 1]
        entry = float(nxt["open"])
        exit_ = float(nxt["close"])
        if entry <= 0:
            continue
        ret = (exit_ / entry - 1.0) * 100.0
        trades.append(
            WatchlistTrade(
                symbol=symbol,
                signal_date=str(signal_date.date()),
                entry_date=str(df.index[loc + 1].date()),
                exit_date=str(df.index[loc + 1].date()),
                entry_price=entry,
                exit_price=exit_,
                return_pct=ret,
                day_pct=float(row["day_pct"]),
                rel_vol=float(row["rel_vol"]),
                entry_timing=str(row["entry_timing"]),
            )
        )

    return trades


def summarize(trades: list[WatchlistTrade]) -> dict:
    if not trades:
        return {
            "n_trades": 0,
            "win_rate_pct": 0.0,
            "avg_return_pct": 0.0,
            "median_return_pct": 0.0,
        }
    rets = np.array([t.return_pct for t in trades])
    wins = (rets > 0).sum()
    return {
        "n_trades": len(trades),
        "win_rate_pct": round(float(wins / len(trades) * 100), 2),
        "avg_return_pct": round(float(rets.mean()), 3),
        "median_return_pct": round(float(np.median(rets)), 3),
        "hot_trades": sum(1 for t in trades if t.entry_timing == "hot"),
    }


def _download(tickers: list[str], start: str) -> dict[str, pd.DataFrame]:
    import yfinance as yf

    raw = yf.download(
        tickers,
        start=start,
        auto_adjust=True,
        progress=False,
        group_by="ticker",
        threads=True,
    )
    out: dict[str, pd.DataFrame] = {}
    if len(tickers) == 1:
        sym = tickers[0]
        d = raw.copy()
        d.columns = [c.lower() if isinstance(c, str) else c for c in d.columns]
        if isinstance(d.columns, pd.MultiIndex):
            d.columns = d.columns.get_level_values(0)
        out[sym] = d
        return out
    for sym in tickers:
        if sym not in raw.columns.get_level_values(0):
            continue
        d = raw[sym].copy()
        d.columns = [str(c).lower() for c in d.columns]
        out[sym] = d.dropna(how="all")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Module 1 watchlist backtest (production rules)")
    parser.add_argument("--tickers", default="AAPL,MSFT,NVDA", help="Comma-separated symbols")
    parser.add_argument("--start", default="2023-01-01")
    parser.add_argument(
        "--out",
        default="pipeline/research/artifacts/watchlist_backtest_summary.json",
    )
    args = parser.parse_args()
    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]

    panels = _download(tickers, args.start)
    all_trades: list[WatchlistTrade] = []
    by_symbol: dict[str, dict] = {}

    for sym, panel in panels.items():
        trades = simulate_watchlist_trades(sym, panel)
        all_trades.extend(trades)
        by_symbol[sym] = summarize(trades)

    summary = {"overall": summarize(all_trades), "by_symbol": by_symbol}
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
