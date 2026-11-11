"""Backtest LOOP books on Yahoo Finance OHLCV (merged S&P + Nasdaq-100 LOOP universe).

Books:
  - donchian_prod: Donchian 55 + 20d VWAP entry, ATR(14)×2.0 chandelier exit (production LOOP)
  - xs: 63-session sector residual, top 8 / max 2 per sector, 5-session rebalance, wide SMA20 trail
  - equal_weight: equal-weight all tradable symbols with data (buy-and-hold basket, daily rebalance)
  - spy: SPY total return

Paper costs: 10 bps per side on turnover (Donchian uses execution helper; XS uses validation turnover).

Usage:
    PYTHONPATH=/workspace python -m pipeline.research.loop_yahoo_backtest
    PYTHONPATH=/workspace python -m pipeline.research.loop_yahoo_backtest --start 2025-01-01 --end 2026-09-26
"""
from __future__ import annotations

import argparse
import json
import logging
import os
from dataclasses import dataclass
from datetime import date

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from pipeline.compute.donchian_vwap import MAX_PER_SECTOR, REBALANCE_DAYS, TOP_N
from pipeline.compute.loop_atr_trail import LOOP_ATR_MULT, LOOP_ATR_PERIOD
from pipeline.compute.relative_strength import percentile_ranks, sector_residual_returns, window_return
from pipeline.compute.trail_exit import TrailState
from pipeline.research.donchian_vwap_backtest import (
    PeriodMetrics,
    _metrics,
    _universe,
    benchmark_returns,
    build_research_panels,
    is_oos_split,
    run_donchian_vwap_portfolio,
)
from pipeline.research.tema_search import equity_kpis
from pipeline.research.validation.metrics import apply_turnover, side_cost_fraction, spell_returns

logger = logging.getLogger(__name__)

XS_WARMUP = 70
XS_LOOKBACK = 63


@dataclass(frozen=True)
class BookSeries:
    name: str
    daily: pd.Series


def _calendar(panels: dict[str, pd.DataFrame], start: date, end: date) -> list[date]:
    spy = panels.get("SPY")
    if spy is None or spy.empty:
        raise RuntimeError("SPY panel required for calendar")
    days = [d.date() if hasattr(d, "date") else d for d in spy.index]
    return [d for d in days if start <= d <= end]


def _close_on(panel: pd.DataFrame, d: date) -> float | None:
    ts = pd.Timestamp(d)
    idx = panel.index.tz_localize(None) if getattr(panel.index, "tz", None) else panel.index
    hits = idx.normalize() == ts
    if not hits.any():
        return None
    val = float(panel.loc[hits, "close"].iloc[0])
    return val if np.isfinite(val) and val > 0 else None


def run_xs_book(
    panels: dict[str, pd.DataFrame],
    sym_sector: dict[str, str],
    start: date,
    end: date,
) -> BookSeries:
    """XS sleeve on Yahoo closes — mirrors validation ``run_xs``."""
    symbols = [s for s in panels if s != "SPY"]
    days = _calendar(panels, start, end)
    if len(days) < XS_WARMUP + 2:
        return BookSeries("xs", pd.Series(dtype=float))

    # Pre-index closes by day for each symbol
    close_by_sym: dict[str, dict[date, float]] = {}
    for sym in symbols:
        panel = panels[sym]
        close_by_sym[sym] = {}
        for d in days:
            px = _close_on(panel, d)
            if px is not None:
                close_by_sym[sym][d] = px

    holdings: dict[str, float] = {}
    trails: dict[str, TrailState] = {}
    daily_vals: list[float] = []
    daily_idx: list[pd.Timestamp] = []
    cost_side = side_cost_fraction()
    hold_leg = 0.0
    trades_pct: list[float] = []

    for i in range(XS_WARMUP, len(days) - 1):
        d = days[i]
        d_next = days[i + 1]
        cost = 0.0
        if (i - XS_WARMUP) % REBALANCE_DAYS == 0:
            if (i - XS_WARMUP) > 0 and hold_leg != 0.0:
                trades_pct.append(hold_leg * 100.0)
            hold_leg = 0.0
            raw: dict[str, float] = {}
            for sym in symbols:
                series = close_by_sym[sym]
                if len(series) < XS_LOOKBACK + 2:
                    continue
                hist = [series[days[j]] for j in range(i + 1) if days[j] in series]
                if len(hist) < XS_LOOKBACK + 1:
                    continue
                close_s = pd.Series(hist)
                ret = window_return(close_s, lookback=XS_LOOKBACK)
                if ret is not None:
                    raw[sym] = ret
            resid = sector_residual_returns(raw, sym_sector)
            ranks = percentile_ranks(resid)
            ranked = sorted(ranks, key=lambda s: (-ranks[s], s))
            picked: list[str] = []
            per_sec: dict[str, int] = {}
            for sym in ranked:
                sec = sym_sector.get(sym, "Unknown")
                if per_sec.get(sec, 0) >= MAX_PER_SECTOR:
                    continue
                picked.append(sym)
                per_sec[sec] = per_sec.get(sec, 0) + 1
                if len(picked) >= TOP_N:
                    break
            new = {sym: 1.0 / len(picked) for sym in picked} if picked else {}
            delta = sum(abs(new.get(sym, 0.0) - holdings.get(sym, 0.0)) for sym in set(holdings) | set(new))
            cost = delta * cost_side
            holdings = new
            for sym in list(trails):
                if sym not in holdings:
                    trails.pop(sym, None)
            for sym in holdings:
                if sym not in trails:
                    px = close_by_sym[sym].get(d)
                    if px is not None:
                        trails[sym] = TrailState(entry_price=px, current_sl=0.0, peak_price=px)

        day_ret = -cost
        for sym, w in holdings.items():
            a = close_by_sym[sym].get(d)
            b = close_by_sym[sym].get(d_next)
            if a and b and a > 0:
                day_ret += w * (b / a - 1.0)

        # Wide trail on close of d_next (after earning t→t+1 return)
        for sym in list(holdings):
            state = trails.get(sym)
            if state is None:
                continue
            panel = panels.get(sym)
            if panel is None:
                continue
            px = close_by_sym[sym].get(d_next)
            if px is None:
                continue
            try:
                loc = panel.index.get_indexer([pd.Timestamp(d_next)], method="nearest")[0]
                row = panel.iloc[loc]
                hi = float(row["high"])
                closes_hist = panel["close"].iloc[: loc + 1].astype(float)
                sma_v = float(closes_hist.rolling(20, min_periods=20).mean().iloc[-1])
            except Exception:
                hi, sma_v = px, 0.0
            state.update(hi, px, sma_v)
            if state.trail_active and px < state.current_sl:
                day_ret -= holdings[sym] * cost_side
                holdings.pop(sym)
                trails.pop(sym, None)

        hold_leg += day_ret
        daily_vals.append(float(day_ret))
        daily_idx.append(pd.Timestamp(d_next))

    if hold_leg != 0.0:
        trades_pct.append(hold_leg * 100.0)

    daily = pd.Series(daily_vals, index=pd.DatetimeIndex(daily_idx))
    return BookSeries("xs", daily)


def run_equal_weight_book(
    panels: dict[str, pd.DataFrame],
    start: date,
    end: date,
) -> BookSeries:
    symbols = [s for s in panels if s != "SPY"]
    days = _calendar(panels, start, end)
    rets: list[float] = []
    idx: list[pd.Timestamp] = []
    for i in range(len(days) - 1):
        d, d_next = days[i], days[i + 1]
        parts: list[float] = []
        for sym in symbols:
            a = _close_on(panels[sym], d)
            b = _close_on(panels[sym], d_next)
            if a and b and a > 0:
                parts.append(b / a - 1.0)
        if not parts:
            continue
        rets.append(float(np.mean(parts)))
        idx.append(pd.Timestamp(d_next))
    return BookSeries("equal_weight", pd.Series(rets, index=pd.DatetimeIndex(idx)))


def period_kpis(daily: pd.Series, trades_pct: list[float] | None = None) -> dict:
    if daily.empty:
        return equity_kpis(np.array([]), np.array([]))
    r = daily.astype(float).values
    # spell trades from position series approximated by non-zero days
    pooled = np.asarray(trades_pct or [], dtype=float)
    if pooled.size == 0:
        active = (daily.abs() > 1e-12).astype(float).values
        pooled = spell_returns(active, r) * 100.0
    return equity_kpis(r, pooled)


def summarize_periods(daily: pd.Series, trades_pct: list[float] | None = None) -> dict:
    (is_start, is_end), (oos_start, oos_end) = is_oos_split()
    full_start, full_end = is_start, oos_end

    def pack(label: str, s: date, e: date) -> dict:
        m = _metrics(label, s, e, daily)
        mask = (daily.index >= pd.Timestamp(s)) & (daily.index <= pd.Timestamp(e))
        seg = daily.loc[mask]
        kpis = period_kpis(seg, trades_pct)
        return {
            "return_pct": round(m.total_return_pct, 2),
            "sharpe": round(m.sharpe, 2),
            "max_drawdown_pct": round(m.max_drawdown_pct, 2),
            "days": m.days,
            **{k: round(v, 4) if isinstance(v, float) else v for k, v in kpis.items() if k in {
                "sortino", "cagr", "total_return", "max_drawdown", "calmar", "profit_factor",
                "day_win_rate", "n_trades", "trade_win_rate", "avg_trade",
            }},
        }

    return {
        "full": pack("full", full_start, full_end),
        "is": pack("is", is_start, is_end),
        "oos": pack("oos", oos_start, oos_end),
    }


def save_figure(books: dict[str, pd.Series], path: str) -> None:
    fig, axes = plt.subplots(2, 1, figsize=(11, 7), sharex=True)
    (is_start, is_end), (oos_start, oos_end) = is_oos_split()
    split = pd.Timestamp(oos_start)
    for name, daily in books.items():
        if daily.empty:
            continue
        eq = (1 + daily.fillna(0.0)).cumprod()
        axes[0].plot(eq.index, eq.values, label=name)
    axes[0].axvline(split, color="gray", ls="--", lw=1, alpha=0.8)
    axes[0].set_ylabel("Growth of $1")
    axes[0].set_title("LOOP Yahoo Finance backtest")
    axes[0].legend(fontsize=8)
    axes[0].grid(alpha=0.3)
    for name, daily in books.items():
        mask = daily.index >= split
        seg = daily.loc[mask]
        if seg.empty:
            continue
        eq = (1 + seg.fillna(0.0)).cumprod()
        axes[1].plot(eq.index, eq.values, label=name)
    axes[1].set_title("OOS window")
    axes[1].set_ylabel("Growth of $1")
    axes[1].legend(fontsize=8)
    axes[1].grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def run_all(
    start: date | None = None,
    end: date | None = None,
    data_start: str = "2022-06-01",
) -> dict:
    (is_start, is_end), (oos_start, oos_end) = is_oos_split()
    full_start = start or is_start
    full_end = end or oos_end

    sym_sector = _universe()
    logger.info("Downloading Yahoo panels for %d symbols (from %s)…", len(sym_sector), data_start)
    panels, signals = build_research_panels(data_start)

    dc_daily, _ = run_donchian_vwap_portfolio(
        full_start,
        full_end,
        data_start=data_start,
        exit_mode="atr_trail",
        atr_period=LOOP_ATR_PERIOD,
        atr_mult=LOOP_ATR_MULT,
        panels=panels,
        signals=signals,
        sym_sector=sym_sector,
    )
    xs = run_xs_book(panels, sym_sector, full_start, full_end).daily
    ew = run_equal_weight_book(panels, full_start, full_end).daily
    spy = benchmark_returns(full_start, full_end, "SPY")

    books = {
        "donchian_prod": dc_daily,
        "xs": xs,
        "equal_weight": ew,
        "spy": spy,
    }

    out_books = {}
    for key, daily in books.items():
        out_books[key] = summarize_periods(daily)

    summary = {
        "source": "yahoo_finance",
        "universe": "loop_merged_sp500_ndx_ex_pharma",
        "data_start": data_start,
        "window": {"start": full_start.isoformat(), "end": full_end.isoformat()},
        "is_oos_split": {
            "is": [is_start.isoformat(), is_end.isoformat()],
            "oos": [oos_start.isoformat(), oos_end.isoformat()],
        },
        "donchian_rules": {
            "entry": "close > prior 55d high and close > 20d VWAP",
            "exit": f"ATR({LOOP_ATR_PERIOD})×{LOOP_ATR_MULT} chandelier",
            "top_n": TOP_N,
            "max_per_sector": MAX_PER_SECTOR,
            "rebalance_days": REBALANCE_DAYS,
        },
        "xs_rules": {
            "lookback": XS_LOOKBACK,
            "top_n": TOP_N,
            "max_per_sector": MAX_PER_SECTOR,
            "rebalance_days": REBALANCE_DAYS,
            "trail": "wide SMA20",
        },
        "cost_bps_per_side": 10,
        "symbols_downloaded": len([s for s in panels if s != "SPY"]),
        "books": out_books,
        "note": "Merged index universe via yfinance. IS 2023–2024, OOS 2025–2026-09-26. Not a live-edge claim.",
    }
    return summary, books


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="LOOP Donchian + XS backtest on Yahoo Finance")
    parser.add_argument("--start", type=str, default=None, help="YYYY-MM-DD (default: IS start 2023-01-01)")
    parser.add_argument("--end", type=str, default=None, help="YYYY-MM-DD (default: OOS end 2026-09-26)")
    parser.add_argument("--data-start", type=str, default="2022-06-01", help="Yahoo history pull start")
    parser.add_argument(
        "--out-json",
        type=str,
        default="pipeline/research/artifacts/loop_yahoo_backtest.json",
    )
    parser.add_argument(
        "--out-png",
        type=str,
        default="pipeline/research/artifacts/loop_yahoo_backtest.png",
    )
    args = parser.parse_args()

    start = date.fromisoformat(args.start) if args.start else None
    end = date.fromisoformat(args.end) if args.end else None

    summary, books = run_all(start=start, end=end, data_start=args.data_start)
    os.makedirs(os.path.dirname(args.out_json) or ".", exist_ok=True)
    with open(args.out_json, "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2)
    save_figure(books, args.out_png)
    logger.info("Wrote %s and %s", args.out_json, args.out_png)

    for key in ("donchian_prod", "xs", "equal_weight", "spy"):
        oos = summary["books"][key]["oos"]
        logger.info(
            "%s OOS: return %+.1f%% Sharpe %.2f maxDD %.1f%% (%d days)",
            key,
            oos["return_pct"],
            oos["sharpe"],
            oos["max_drawdown_pct"],
            oos["days"],
        )


if __name__ == "__main__":
    main()
