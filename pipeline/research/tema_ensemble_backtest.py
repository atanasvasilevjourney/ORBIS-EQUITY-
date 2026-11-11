"""Backtest the equity TEMA-MACD rules on real closes.

Rules, fixed before this run:

- Long only. A short histogram is flat, never a short.
- Three spreads vote: 8/21, 12/50, 8/63, each with a 9-bar signal.
- Enter when the close is above TEMA-199 and at least two histograms are positive.
- Stay in while the close holds TEMA-199. A histogram flip does not exit.
- Desk book: top 3 names, at most 2 in one sector, equal weight. Empty book is cash.

The live comparison is the 9/99/199 swing with the price MACD as the flatten,
top 3 longs and top 3 shorts, same sector cap. Buy-and-hold is the equal-weight
of the same names. All three pay 10 bps a side and are scored on the same days,
the sessions after TEMA-199 can exist.

Usage:
    PYTHONPATH=/workspace python -m pipeline.research.tema_ensemble_backtest
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass

import numpy as np
import pandas as pd

from pipeline.compute.perps_math import ema, tema
from pipeline.research.tema_search import TemaParams, equity_kpis, load_top_panel
from pipeline.research.validation.metrics import apply_turnover, spell_returns

logger = logging.getLogger(__name__)

PAIRS = ((8, 21, 9), (12, 50, 9), (8, 63, 9))
REGIME_SPAN = 199
ENTRY_VOTES = 2
TOP_N = 3
SECTOR_CAP = 2


@dataclass(frozen=True)
class BookResult:
    name: str
    daily: np.ndarray
    weights: np.ndarray


def sticky_long(regime_up: np.ndarray, votes: np.ndarray, start: int, entry_votes: int = ENTRY_VOTES) -> np.ndarray:
    """1 while a long is open. Enter on the vote, exit only when the regime breaks."""
    n = int(regime_up.size)
    pos = np.zeros(n)
    holding = False
    for i in range(max(0, start), n):
        up = bool(regime_up[i])
        if holding:
            if not up:
                holding = False
        elif up and float(votes[i]) >= entry_votes:
            holding = True
        pos[i] = 1.0 if holding else 0.0
    return pos


def select_weights(
    active: np.ndarray,
    score: np.ndarray,
    sectors: list[str],
    top_n: int = TOP_N,
    sector_cap: int = SECTOR_CAP,
) -> np.ndarray:
    """Equal weight of the top names. A sector can fill at most ``sector_cap`` slots."""
    symbols, n_dates = active.shape
    weights = np.zeros((symbols, n_dates))
    for t in range(n_dates):
        order = [i for i in range(symbols) if active[i, t]]
        order.sort(key=lambda i: (-float(score[i, t]), i))
        picked: list[int] = []
        counts: dict[str, int] = {}
        for i in order:
            sector = sectors[i]
            if sector_cap > 0 and counts.get(sector, 0) >= sector_cap:
                continue
            picked.append(i)
            counts[sector] = counts.get(sector, 0) + 1
            if len(picked) >= top_n:
                break
        if not picked:
            continue
        share = 1.0 / len(picked)
        for i in picked:
            weights[i, t] = share
    return weights


def _histogram(close: np.ndarray, fast: int, slow: int, signal: int) -> np.ndarray:
    line = tema(close, fast) - tema(close, slow)
    return line - ema(line, signal)


def new_state(closes: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per name: long mask, vote count, distance of the close above TEMA-199."""
    symbols, n_dates = closes.shape
    active = np.zeros((symbols, n_dates))
    votes = np.zeros((symbols, n_dates))
    distance = np.zeros((symbols, n_dates))
    for i in range(symbols):
        close = closes[i]
        regime = tema(close, REGIME_SPAN)
        hist = np.vstack([_histogram(close, fast, slow, signal) for fast, slow, signal in PAIRS])
        vote = np.sum(hist > 0, axis=0).astype(float)
        up = close > regime
        active[i] = sticky_long(up, vote, REGIME_SPAN, ENTRY_VOTES)
        votes[i] = vote
        distance[i] = close / np.where(regime == 0, np.nan, regime) - 1.0
    return active, votes, distance


def new_desk_weights(closes: np.ndarray, sectors: list[str]) -> np.ndarray:
    active, votes, distance = new_state(closes)
    score = votes * 10.0 + np.nan_to_num(distance, nan=0.0)
    return select_weights(active > 0, score, sectors, TOP_N, SECTOR_CAP)


def new_equal_weights(closes: np.ndarray) -> np.ndarray:
    active, _votes, _distance = new_state(closes)
    counts = active.sum(axis=0)
    weights = np.zeros_like(active)
    for t in range(active.shape[1]):
        if counts[t] > 0:
            weights[active[:, t] > 0, t] = 1.0 / counts[t]
    return weights


def live_desk_weights(panel, sectors: list[str]) -> np.ndarray:
    """Production swing: 9/99/199 plus the price MACD flatten, top 3 a side."""
    side = panel.signal(TemaParams(fast=9, mid=99, slow=199, kama_gate=0), warmup=REGIME_SPAN)
    slow = np.vstack([panel.tema_row(i, REGIME_SPAN) for i in range(panel.n_symbols)])
    distance = panel.closes / np.where(slow == 0, np.nan, slow) - 1.0
    distance = np.nan_to_num(distance, nan=0.0)
    long_w = select_weights(side > 0, distance, sectors, TOP_N, SECTOR_CAP)
    short_w = select_weights(side < 0, -distance, sectors, TOP_N, SECTOR_CAP)
    both = (long_w.sum(axis=0) > 0) & (short_w.sum(axis=0) > 0)
    long_w[:, both] *= 0.5
    short_w[:, both] *= 0.5
    return long_w - short_w


def portfolio_returns(panel, target: np.ndarray) -> np.ndarray:
    """Target at close t earns the return from t to t+1. Costs follow each name's weight."""
    weight = np.zeros_like(target, dtype=float)
    weight[:, 1:] = target[:, :-1]
    bar = np.nan_to_num(panel.rets, nan=0.0)
    book = np.zeros(panel.n_dates)
    for i in range(panel.n_symbols):
        book += apply_turnover(weight[i], bar[i])
    book[0] = np.nan
    return book


def buyhold_weights(n_symbols: int, n_dates: int, start: int) -> np.ndarray:
    weights = np.zeros((n_symbols, n_dates))
    weights[:, start:] = 1.0 / n_symbols
    return weights


def _window_kpis(panel, daily: np.ndarray, weights: np.ndarray, start: int) -> dict:
    trades = []
    bar = np.nan_to_num(panel.rets[:, start:], nan=0.0)
    held = weights[:, start:]
    for i in range(panel.n_symbols):
        trades.append(spell_returns(held[i], bar[i]))
    pooled = np.concatenate(trades) if trades else np.array([])
    kpis = equity_kpis(daily[start:], pooled)
    window = weights[:, start:]
    kpis["exposure"] = float(np.mean(np.sum(np.abs(window), axis=0))) if window.size else 0.0
    kpis["names"] = float(np.mean(np.sum(np.abs(window) > 1e-9, axis=0))) if window.size else 0.0
    return kpis


def run_books(panel, sectors: list[str]) -> dict[str, BookResult]:
    if len(sectors) != panel.n_symbols:
        raise ValueError("sectors must align with the panel rows")
    start = REGIME_SPAN
    new_w = new_desk_weights(panel.closes, sectors)
    new_w[:, :start] = 0.0
    equal_w = new_equal_weights(panel.closes)
    equal_w[:, :start] = 0.0
    live_w = live_desk_weights(panel, sectors)
    live_w[:, :start] = 0.0
    hold_w = buyhold_weights(panel.n_symbols, panel.n_dates, start)
    books = {
        "new_desk": BookResult("New desk", portfolio_returns(panel, new_w), new_w),
        "new_equal": BookResult("New equal-weight", portfolio_returns(panel, equal_w), equal_w),
        "live_desk": BookResult("Live 9/99/199 desk", portfolio_returns(panel, live_w), live_w),
        "buyhold": BookResult("Buy and hold", portfolio_returns(panel, hold_w), hold_w),
    }
    return books


def _load_sectors(symbols: list[str]) -> list[str]:
    from dotenv import load_dotenv
    from supabase import create_client

    from pipeline.utils.supabase import fetch_all

    load_dotenv()
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    sb = create_client(url, key)
    rows = fetch_all(sb, "universe_members", "symbol,sector")
    found = {row["symbol"]: (row.get("sector") or "Other") for row in rows if row.get("symbol")}
    return [found.get(symbol) or "Other" for symbol in symbols]


def _curve(daily: np.ndarray, start: int) -> np.ndarray:
    r = np.nan_to_num(daily[start:], nan=0.0)
    return np.cumprod(1.0 + r)


def save_figure(panel, books: dict[str, BookResult], path: str) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    start = REGIME_SPAN + 1
    dates = panel.dates[start:]
    fig, ax = plt.subplots(figsize=(10.5, 4.8))
    colors = {
        "new_desk": "#1f6feb",
        "new_equal": "#8aa0b4",
        "live_desk": "#b91c1c",
        "buyhold": "#15803d",
    }
    for key, book in books.items():
        ax.plot(dates, _curve(book.daily, start), color=colors[key], lw=1.6, label=book.name)
    ax.set_ylabel("Growth of 1")
    ax.set_xlabel("Session")
    ax.set_title("TEMA books after the 199-day warmup")
    ax.legend(frameon=False, fontsize=8)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def summarize(panel, sectors: list[str], books: dict[str, BookResult]) -> dict:
    start = REGIME_SPAN + 1
    rows = {}
    for key, book in books.items():
        rows[key] = _window_kpis(panel, book.daily, book.weights, start)
    return {
        "symbols": panel.n_symbols,
        "sessions": panel.n_dates,
        "start": panel.dates[0].date().isoformat(),
        "end": panel.dates[-1].date().isoformat(),
        "scored_from": panel.dates[start].date().isoformat(),
        "scored_days": int(panel.n_dates - start),
        "sectors": len(set(sectors)),
        "rules": {
            "pairs": [list(pair) for pair in PAIRS],
            "regime": REGIME_SPAN,
            "entry_votes": ENTRY_VOTES,
            "top_n": TOP_N,
            "sector_cap": SECTOR_CAP,
            "cost_bps_per_side": 10,
        },
        "note": (
            "TEMA-199 consumes the first 199 sessions, so this tape has no separate "
            "train window for the new rule. The scored days are the only days the rule can trade. "
            "The rule was written after an earlier look at this same tape."
        ),
        "books": rows,
    }


def _round(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: _round(item) for key, item in value.items()}
    return value


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    panel = load_top_panel(100)
    sectors = _load_sectors(panel.symbols)
    logger.info("Sectors %d distinct", len(set(sectors)))
    books = run_books(panel, sectors)
    summary = summarize(panel, sectors, books)
    out_dir = "pipeline/research/artifacts"
    os.makedirs(out_dir, exist_ok=True)
    json_path = os.path.join(out_dir, "tema_ensemble_backtest.json")
    fig_path = os.path.join(out_dir, "tema_ensemble_backtest.png")
    with open(json_path, "w", encoding="utf-8") as handle:
        json.dump(_round(summary), handle, indent=2)
    save_figure(panel, books, fig_path)
    logger.info("Wrote %s", json_path)
    for key, kpis in summary["books"].items():
        logger.info(
            "%s  Sharpe %.2f  return %.1f%%  maxDD %.1f%%  exposure %.2f  names %.1f",
            key,
            kpis["sharpe"],
            kpis["total_return"] * 100.0,
            kpis["max_drawdown"] * 100.0,
            kpis["exposure"],
            kpis["names"],
        )


if __name__ == "__main__":
    main()
