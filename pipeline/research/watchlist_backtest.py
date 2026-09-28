"""Backtest the module-1 watchlist as a next-session book.

The screener does not place orders. This test applies one mechanical rule
that daily bars can support without lookahead:

  Signal   known at the close (day change, 50-day relative volume, distance from the high)
  On list  day >= +4% and volume >= 2× the prior 50 sessions
  Hot      day >= +10% and volume >= 5×
  Book     up to 8 names, closest to the session high first, equal weight
  Trade    buy the next session's open, sell that session's close
  Cash     0 when the list is empty

Same-day open-to-close is not used: the scan is only known after the close.
Current S&P 500 ∪ Nasdaq-100 membership (ex-pharma) is a survivorship bias.

Usage:
    python -m pipeline.research.watchlist_backtest
    python -m pipeline.research.watchlist_backtest --start 2023-01-01 --end 2026-09-26
"""
from __future__ import annotations

import argparse
from datetime import date, datetime

import numpy as np
import pandas as pd

from pipeline.compute.trend_radar import (
    HOT_MIN_DAY_PCT,
    HOT_MIN_REL_VOLUME,
    REL_VOL_BARS,
    WATCH_MIN_DAY_PCT,
    WATCH_MIN_REL_VOLUME,
)
from pipeline.ingest.us_index_universe import build_merged_universe
from pipeline.research.loop_backtest import _download_panel
from pipeline.universe_filters import is_loop_tradable, is_pharma_stock

TOP_N = 8
EQUITY = 100_000.0
COST_BPS_PER_SIDE = 10.0  # liquid large-cap estimate
DATA_START = "2022-06-01"


def signal_frame(ohlcv: pd.DataFrame) -> pd.DataFrame:
    """Per-bar scan fields plus the next session's open-to-close return."""
    d = ohlcv.sort_index().copy()
    if getattr(d.index, "tz", None) is not None:
        d.index = d.index.tz_localize(None)
    close = d["close"].astype(float)
    high = d["high"].astype(float)
    volume = d["volume"].astype(float)
    day_pct = close.pct_change() * 100.0
    rel_vol = volume / volume.shift(1).rolling(REL_VOL_BARS, min_periods=REL_VOL_BARS).mean()
    off_high = (close / high.replace(0, np.nan) - 1.0) * 100.0
    nxt_open = d["open"].astype(float).shift(-1)
    nxt_close = close.shift(-1)
    out = pd.DataFrame(
        {
            "day_pct": day_pct,
            "rel_vol": rel_vol,
            "off_high": off_high,
            "on_list": (day_pct >= WATCH_MIN_DAY_PCT) & (rel_vol >= WATCH_MIN_REL_VOLUME),
            "hot": (day_pct >= HOT_MIN_DAY_PCT) & (rel_vol >= HOT_MIN_REL_VOLUME),
            "next_oc": nxt_close / nxt_open - 1.0,
        },
        index=d.index,
    )
    out["exit_date"] = pd.Series(d.index, index=d.index).shift(-1)
    return out.dropna(subset=["day_pct", "rel_vol", "off_high", "next_oc", "exit_date"])


def select_book(
    signals: pd.DataFrame,
    *,
    hot_only: bool,
    top_n: int = TOP_N,
    rank_col: str = "off_high",
) -> pd.DataFrame:
    """One row per chosen name. Default rank is closest to the session high."""
    mask = signals["hot"] if hot_only else signals["on_list"]
    eligible = signals.loc[mask].copy()
    if eligible.empty:
        return eligible
    eligible = eligible.sort_values(["date", rank_col, "day_pct"], ascending=[True, False, False])
    return eligible.groupby("date", sort=True).head(top_n)


def portfolio_returns(book: pd.DataFrame, calendar: pd.DatetimeIndex) -> pd.Series:
    """Equal-weight next-session return, indexed on the exit date. Cash = 0."""
    idx = pd.DatetimeIndex(calendar).tz_localize(None).normalize().unique().sort_values()
    if book.empty:
        return pd.Series(0.0, index=idx, name="ret")
    daily = book.groupby(pd.to_datetime(book["exit_date"]).dt.normalize())["next_oc"].mean()
    out = daily.reindex(idx).fillna(0.0)
    out.name = "ret"
    return out


def apply_cost(returns: pd.Series, book: pd.DataFrame) -> pd.Series:
    """Subtract a round trip on sessions that actually hold names."""
    if book.empty:
        return returns.copy()
    held = set(pd.to_datetime(book["exit_date"]).dt.normalize())
    cost = (COST_BPS_PER_SIDE * 2.0) / 10_000.0
    net = returns.copy()
    net.loc[net.index.isin(held)] = net.loc[net.index.isin(held)] - cost
    return net


def _metrics(returns: pd.Series) -> dict:
    r = returns.dropna()
    if r.empty:
        return {"total_return_pct": 0.0, "cagr_pct": 0.0, "max_dd_pct": 0.0, "sharpe": 0.0, "days": 0}
    eq = (1.0 + r).cumprod()
    years = max(len(r) / 252.0, 1 / 252.0)
    total = float(eq.iloc[-1] - 1.0)
    cagr = float(eq.iloc[-1] ** (1.0 / years) - 1.0)
    dd = float((eq / eq.cummax() - 1.0).min())
    sharpe = float(r.mean() / r.std() * np.sqrt(252)) if float(r.std()) > 0 else 0.0
    return {
        "total_return_pct": total * 100,
        "cagr_pct": cagr * 100,
        "max_dd_pct": dd * 100,
        "sharpe": sharpe,
        "days": int(len(r)),
    }


def _slice(returns: pd.Series, start: date, end: date) -> pd.Series:
    mask = (returns.index >= pd.Timestamp(start)) & (returns.index <= pd.Timestamp(end))
    return returns.loc[mask]


def _universe() -> list[str]:
    stocks, _ = build_merged_universe()
    return sorted(
        {
            s["symbol"]
            for s in stocks
            if is_loop_tradable({**s, "is_active": not is_pharma_stock(s)})
        }
    )


def build_signal_table(panels: dict[str, pd.DataFrame]) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    for sym, ohlcv in panels.items():
        if sym == "SPY" or len(ohlcv) < REL_VOL_BARS + 5:
            continue
        try:
            sig = signal_frame(ohlcv)
        except Exception:
            continue
        if sig.empty:
            continue
        sig = sig.reset_index()
        date_col = "Date" if "Date" in sig.columns else sig.columns[0]
        sig = sig.rename(columns={date_col: "date"})
        sig["symbol"] = sym
        sig["date"] = pd.to_datetime(sig["date"]).dt.tz_localize(None).dt.normalize()
        sig["exit_date"] = pd.to_datetime(sig["exit_date"]).dt.tz_localize(None).dt.normalize()
        frames.append(sig)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def run(start: date, end: date) -> str:
    symbols = _universe()
    panels = _download_panel(symbols + ["SPY"], DATA_START)
    spy = panels.get("SPY")
    if spy is None or spy.empty:
        raise RuntimeError("SPY history missing")
    if getattr(spy.index, "tz", None) is not None:
        spy = spy.copy()
        spy.index = spy.index.tz_localize(None)

    signals = build_signal_table(panels)
    if signals.empty:
        raise RuntimeError("No watchlist signals")

    window = signals[(signals["date"] >= pd.Timestamp(start)) & (signals["date"] <= pd.Timestamp(end))]
    cal = spy.index[(spy.index >= pd.Timestamp(start)) & (spy.index <= pd.Timestamp(end))]

    on_book = select_book(window, hot_only=False)
    hot_book = select_book(window, hot_only=True)
    on_ret = portfolio_returns(on_book, cal)
    hot_ret = portfolio_returns(hot_book, cal)
    on_net = apply_cost(on_ret, on_book)
    hot_net = apply_cost(hot_ret, hot_book)

    spy_ret = spy["close"].astype(float).pct_change().reindex(on_ret.index).fillna(0.0)

    def block(title: str, gross: pd.Series, net: pd.Series, book: pd.DataFrame) -> list[str]:
        held_days = int(book["exit_date"].nunique()) if not book.empty else 0
        names = int(len(book)) if not book.empty else 0
        wins = float((book["next_oc"] > 0).mean() * 100) if names else 0.0
        avg = float(book["next_oc"].mean() * 100) if names else 0.0
        g = _metrics(gross)
        n = _metrics(net)
        lines = [
            title,
            f"  trades {names}  invested days {held_days}/{g['days']}  "
            f"avg trade {avg:+.2f}%  win {wins:.1f}%",
            f"  gross  {g['total_return_pct']:+7.1f}%   CAGR {g['cagr_pct']:+5.1f}%   "
            f"maxDD {g['max_dd_pct']:6.1f}%   Sharpe {g['sharpe']:.2f}",
            f"  net    {n['total_return_pct']:+7.1f}%   CAGR {n['cagr_pct']:+5.1f}%   "
            f"maxDD {n['max_dd_pct']:6.1f}%   Sharpe {n['sharpe']:.2f}"
            f"   ({COST_BPS_PER_SIDE:.0f} bps/side)",
        ]
        return lines

    lines = [
        "Module 1 watchlist backtest",
        f"Universe: current S&P 500 ∪ Nasdaq-100, ex-pharma ({len(symbols)} symbols, {len(panels) - (1 if 'SPY' in panels else 0)} with prices)",
        f"Window: {start.isoformat()} → {end.isoformat()}",
        "Rule: top 8 closest to the session high, buy next open, sell that close. Empty list = cash.",
        "Bias: today's index members only. Intraday entries before the close are not in this test.",
        "",
    ]
    lines += block("On list  (day ≥ +4%, rel vol ≥ 2×)", on_ret, on_net, on_book)
    lines.append("")
    lines += block("Hot only (day ≥ +10%, rel vol ≥ 5×)", hot_ret, hot_net, hot_book)
    lines.append("")
    spy_m = _metrics(spy_ret)
    lines.append(
        f"SPY buy & hold   {spy_m['total_return_pct']:+7.1f}%   CAGR {spy_m['cagr_pct']:+5.1f}%   "
        f"maxDD {spy_m['max_dd_pct']:6.1f}%   Sharpe {spy_m['sharpe']:.2f}"
    )
    lines.append("")
    def year_trades(book: pd.DataFrame, year: int) -> int:
        if book.empty:
            return 0
        years = pd.to_datetime(book["date"]).dt.year
        return int((years == year).sum())

    lines.append("By year (gross total return, trade count in parentheses)")
    lines.append(f"  {'year':<6} {'on list':>16} {'hot':>16} {'SPY':>10}")
    years = range(start.year, end.year + 1)
    for year in years:
        y0, y1 = date(year, 1, 1), date(year, 12, 31)
        lines.append(
            f"  {year:<6} {_metrics(_slice(on_ret, y0, y1))['total_return_pct']:+8.1f}%"
            f" ({year_trades(on_book, year):>4})"
            f" {_metrics(_slice(hot_ret, y0, y1))['total_return_pct']:+8.1f}%"
            f" ({year_trades(hot_book, year):>3})"
            f" {_metrics(_slice(spy_ret, y0, y1))['total_return_pct']:+9.1f}%"
        )

    day_book = select_book(window, hot_only=False, rank_col="day_pct")
    day_hot = select_book(window, hot_only=True, rank_col="day_pct")
    day_m = _metrics(portfolio_returns(day_book, cal))
    day_hot_m = _metrics(portfolio_returns(day_hot, cal))
    lines.append("")
    lines.append("Ablation: same gates, rank by day change instead of distance from the high (gross)")
    lines.append(
        f"  on list {day_m['total_return_pct']:+.1f}%   Sharpe {day_m['sharpe']:.2f}   "
        f"maxDD {day_m['max_dd_pct']:.1f}%"
    )
    lines.append(
        f"  hot     {day_hot_m['total_return_pct']:+.1f}%   Sharpe {day_hot_m['sharpe']:.2f}   "
        f"maxDD {day_hot_m['max_dd_pct']:.1f}%"
    )
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Backtest the module-1 watchlist")
    parser.add_argument("--start", default="2023-01-01")
    parser.add_argument("--end", default=date.today().isoformat())
    args = parser.parse_args()
    start = datetime.strptime(args.start, "%Y-%m-%d").date()
    end = datetime.strptime(args.end, "%Y-%m-%d").date()
    print(run(start, end), end="")


if __name__ == "__main__":
    main()
