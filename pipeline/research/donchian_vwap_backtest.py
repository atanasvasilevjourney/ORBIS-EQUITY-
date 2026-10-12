"""Donchian channel + rolling VWAP filter — portfolio backtest for IS/OOS validation."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd
import yfinance as yf

from pipeline.compute.donchian_vwap import (
    ENTRY_CHANNEL,
    EQUITY as INITIAL_EQUITY,
    EXIT_CHANNEL,
    MAX_PER_SECTOR,
    MIN_PRICE as PRICE_MIN,
    REBALANCE_DAYS,
    TOP_N,
    VWAP_WINDOW,
    donchian_frame,
    rolling_vwap,
)
from pipeline.ingest.us_index_universe import build_merged_universe
from pipeline.research.loop_backtest import _bar_on, _download_panel
from pipeline.universe_filters import is_loop_tradable, is_pharma_stock


@dataclass
class PeriodMetrics:
    label: str
    start: date
    end: date
    total_return_pct: float
    max_drawdown_pct: float
    sharpe: float
    days: int


def _universe() -> dict[str, str]:
    stocks, _ = build_merged_universe()
    return {
        s["symbol"]: s.get("sector") or "Unknown"
        for s in stocks
        if is_loop_tradable({**s, "is_active": not is_pharma_stock(s)})
    }


def _donchian_signals(df: pd.DataFrame) -> pd.DataFrame:
    d = df.copy()
    if "date" not in d.columns:
        return donchian_frame(d)
    return donchian_frame(d)


def _metrics(label: str, start: date, end: date, daily_returns: pd.Series) -> PeriodMetrics:
    mask = (daily_returns.index >= pd.Timestamp(start)) & (daily_returns.index <= pd.Timestamp(end))
    r = daily_returns.loc[mask].dropna()
    if r.empty:
        return PeriodMetrics(label, start, end, 0.0, 0.0, 0.0, 0)
    eq = (1 + r).cumprod()
    total = (eq.iloc[-1] - 1) * 100
    dd = (eq / eq.cummax() - 1).min() * 100
    sharpe = float(r.mean() / r.std() * np.sqrt(252)) if r.std() > 0 else 0.0
    return PeriodMetrics(label, start, end, total, dd, sharpe, len(r))


def run_donchian_vwap_portfolio(
    start: date,
    end: date,
    *,
    data_start: str = "2022-06-01",
) -> tuple[pd.Series, pd.DataFrame]:
    """
    Weekly rebalance: hold up to TOP_N names with Donchian(55) break + close > 20d VWAP.
    Exit names on 20-day Donchian lower break between rebalances.
    Equal weight; max MAX_PER_SECTOR per sector.
    Returns (daily_return_series indexed by date, equity_curve dataframe).
    """
    sym_sector = _universe()
    symbols = sorted(sym_sector.keys())
    panels = _download_panel(symbols, data_start)
    if "SPY" not in panels:
        spy = yf.download("SPY", start=data_start, progress=False, auto_adjust=True)
        panels["SPY"] = spy.rename(columns=str.lower)[["open", "high", "low", "close", "volume"]].dropna()

    signals: dict[str, pd.DataFrame] = {}
    for sym, ohlcv in panels.items():
        if sym == "SPY" or len(ohlcv) < ENTRY_CHANNEL + 5:
            continue
        try:
            signals[sym] = _donchian_signals(ohlcv)
        except Exception:
            continue

    cal = panels["SPY"]
    days = [d.date() if hasattr(d, "date") else d for d in cal.index]
    days = [d for d in days if start <= d <= end]

    holdings: dict[str, float] = {}  # symbol -> weight
    equity = INITIAL_EQUITY
    eq_rows: list[dict] = []
    prev_eq = equity

    for i, d in enumerate(days):
        # exits between rebalances
        to_drop = []
        for sym in list(holdings.keys()):
            sig = signals.get(sym)
            if sig is None:
                continue
            row = _bar_on(sig, d)
            if row is not None and bool(row.get("exit_signal", False)):
                to_drop.append(sym)
        for sym in to_drop:
            holdings.pop(sym, None)

        signal_day = days[max(0, i - 1)]  # prior close — no same-bar lookahead
        if i % REBALANCE_DAYS == 0 or not holdings:
            sector_count: dict[str, int] = {}
            cands: list[tuple[str, float]] = []
            for sym, sig in signals.items():
                row = _bar_on(sig, signal_day)
                if row is None:
                    continue
                if not bool(row["eligible"]):
                    continue
                cands.append((sym, float(row["strength"])))
            cands.sort(key=lambda x: -x[1])
            new_hold: dict[str, float] = {}
            for sym, _ in cands:
                sec = sym_sector.get(sym, "Unknown")
                if sector_count.get(sec, 0) >= MAX_PER_SECTOR:
                    continue
                new_hold[sym] = 1.0
                sector_count[sec] = sector_count.get(sec, 0) + 1
                if len(new_hold) >= TOP_N:
                    break
            if new_hold:
                w = 1.0 / len(new_hold)
                holdings = {s: w for s in new_hold}

        day_ret = 0.0
        if holdings:
            parts = []
            for sym, w in holdings.items():
                ohlcv = panels[sym]
                ts = pd.Timestamp(d)
                hits = ohlcv.index.normalize() == ts
                if not hits.any():
                    continue
                loc = int(np.where(hits)[0][0])
                if loc == 0:
                    continue
                r = float(ohlcv.iloc[loc]["close"]) / float(ohlcv.iloc[loc - 1]["close"]) - 1
                parts.append(w * r)
            day_ret = sum(parts) if parts else 0.0

        equity *= 1 + day_ret
        eq_rows.append({"date": d, "equity": equity, "daily_return": day_ret, "names": len(holdings)})
        prev_eq = equity

    if not eq_rows:
        return pd.Series(dtype=float), pd.DataFrame()
    eq_df = pd.DataFrame(eq_rows)
    eq_df.index = pd.to_datetime(eq_df["date"])
    daily = pd.Series(eq_df["daily_return"].values, index=eq_df.index)
    return daily, eq_df


def benchmark_returns(start: date, end: date, ticker: str = "SPY") -> pd.Series:
    h = yf.Ticker(ticker).history(start=start.isoformat(), end=(end.isoformat()), auto_adjust=True)
    if h.empty:
        return pd.Series(dtype=float)
    h.index = h.index.tz_localize(None) if h.index.tz else h.index
    return h["Close"].pct_change().dropna()


def is_oos_split() -> tuple[tuple[date, date], tuple[date, date]]:
    """Fixed split: IS 2023–2024, OOS 2025–latest sample end."""
    is_period = (date(2023, 1, 1), date(2024, 12, 31))
    oos_period = (date(2025, 1, 1), date(2026, 9, 26))
    return is_period, oos_period
