"""Trend Radar entry/exit signal catalog + comparison backtest.

Maps every radar field to actionable alerts, then scores entry×exit pairs
on the same OOS window (next-open fills, no lookahead).

Entry families (leverage order):
  REGIME   — KAMA flip bullish (structure on)
  STATE    — GREEN_FLIP / rank cross into bull zone
  TRIGGER  — breakout+volume, EWMAC cross up, convergence spike

Exit families:
  STATE    — leave GREEN / hit RED
  REGIME   — KAMA turns bearish
  MOMENTUM — EWMAC cross down, rank/convergence collapse

Usage:
  PYTHONPATH=/workspace python -m pipeline.research.radar_signal_matrix
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

import numpy as np
import pandas as pd

from pipeline.compute.trend_radar import BEAR_THRESHOLD, BULL_THRESHOLD
from pipeline.research.radar_alert_backtest import (
    Trade,
    build_radar_history,
    download_ohlcv,
    summarize,
)

# ── Catalog (documentation + machine keys) ─────────────────────────

ENTRY_CATALOG = {
    "GREEN_FLIP": {
        "layer": "state",
        "rule": "state flips into GREEN",
        "ui": "FLIP badge",
    },
    "RANK_CROSS_BULL": {
        "layer": "state",
        "rule": f"quality_rank crosses above {BULL_THRESHOLD}",
        "ui": "rank crossing bull threshold",
    },
    "KAMA_FLIP_BULL": {
        "layer": "regime",
        "rule": "kama_regime flips to +1 (price reclaiming long KAMA)",
        "ui": "KAMA BULL badge on",
    },
    "EWMAC_CROSS_UP": {
        "layer": "momentum",
        "rule": "f_ewmac crosses above 0 while kama_regime >= 0",
        "ui": "EWMAC turn positive under bull regime",
    },
    "BREAKOUT_VOL": {
        "layer": "trigger",
        "rule": "breakout_active AND volume_confirmed (any state)",
        "ui": "BRK + VOL CONFIRMED",
    },
    "BREAKOUT_VOL_GREEN": {
        "layer": "trigger",
        "rule": "breakout+volume while state==GREEN",
        "ui": "BRK+VOL on GREEN row",
    },
    "CONV_SPIKE": {
        "layer": "trigger",
        "rule": "convergence crosses to >=5",
        "ui": "agreement dots light up",
    },
    "GREEN_FLIP_HQ": {
        "layer": "state+trigger",
        "rule": "GREEN_FLIP with rank>=65 and convergence>=4",
        "ui": "high-quality FLIP",
    },
}

EXIT_CATALOG = {
    "left_green": {
        "layer": "state",
        "rule": "state leaves GREEN (FLIP off / GREY)",
    },
    "red_only": {
        "layer": "state",
        "rule": "state == RED (hold through GREY)",
    },
    "kama_bear": {
        "layer": "regime",
        "rule": "kama_regime flips to -1",
    },
    "ewmac_down": {
        "layer": "momentum",
        "rule": "f_ewmac crosses below 0",
    },
    "rank_bear": {
        "layer": "state",
        "rule": f"quality_rank drops to <= {BEAR_THRESHOLD}",
    },
    "conv_collapse": {
        "layer": "trigger",
        "rule": "convergence drops to <=2",
    },
    "red_or_kama": {
        "layer": "state+regime",
        "rule": "state==RED OR kama_regime flips bearish",
    },
}


def enrich_entry_flags(hist: pd.DataFrame) -> pd.DataFrame:
    """Add boolean columns for each entry catalog key (signal on close)."""
    h = hist.copy()
    prev_rank = h["quality_rank"].shift(1)
    prev_kama = h["kama_regime"].shift(1)
    prev_ewmac = h["f_ewmac"].shift(1)
    prev_conv = h["convergence"].shift(1)

    h["entry_GREEN_FLIP"] = h["green_flip"].astype(bool)
    h["entry_RANK_CROSS_BULL"] = (h["quality_rank"] >= BULL_THRESHOLD) & (
        prev_rank < BULL_THRESHOLD
    )
    h["entry_KAMA_FLIP_BULL"] = (h["kama_regime"] > 0) & (prev_kama <= 0)
    h["entry_EWMAC_CROSS_UP"] = (
        (h["f_ewmac"] > 0)
        & (prev_ewmac <= 0)
        & (h["kama_regime"] >= 0)
    )
    h["entry_BREAKOUT_VOL"] = h["breakout_active"] & h["volume_confirmed"]
    h["entry_BREAKOUT_VOL_GREEN"] = h["entry_BREAKOUT_VOL"] & (h["state"] == 1)
    h["entry_CONV_SPIKE"] = (h["convergence"] >= 5) & (prev_conv < 5)
    h["entry_GREEN_FLIP_HQ"] = (
        h["entry_GREEN_FLIP"]
        & (h["quality_rank"] >= 65)
        & (h["convergence"] >= 4)
    )
    return h


def _should_exit(mode: str, hist: pd.DataFrame, j: int, entry_i: int) -> tuple[bool, str]:
    if j <= entry_i:
        return False, ""
    row = hist.iloc[j]
    prev = hist.iloc[j - 1]
    st = int(row["state"])
    kama = int(row["kama_regime"])
    prev_kama = int(prev["kama_regime"])
    ewmac = float(row["f_ewmac"])
    prev_ewmac = float(prev["f_ewmac"])
    rank = int(row["quality_rank"])
    conv = int(row["convergence"])

    if mode == "left_green":
        return st != 1, "left_green"
    if mode == "red_only":
        return st == -1, "hit_red"
    if mode == "kama_bear":
        return kama < 0 and prev_kama >= 0, "kama_bear"
    if mode == "ewmac_down":
        return ewmac < 0 and prev_ewmac >= 0, "ewmac_down"
    if mode == "rank_bear":
        return rank <= BEAR_THRESHOLD, "rank_bear"
    if mode == "conv_collapse":
        return conv <= 2, "conv_collapse"
    if mode == "red_or_kama":
        if st == -1:
            return True, "hit_red"
        if kama < 0 and prev_kama >= 0:
            return True, "kama_bear"
        return False, ""
    raise ValueError(f"unknown exit mode: {mode}")


def simulate_entry_exit(
    ticker: str,
    hist: pd.DataFrame,
    entry_key: str,
    exit_mode: str,
    *,
    from_date: str | None = None,
    max_hold_bars: int = 60,
) -> list[Trade]:
    col = f"entry_{entry_key}"
    if col not in hist.columns:
        raise KeyError(col)

    trades: list[Trade] = []
    i = 0
    n = len(hist)
    while i < n - 1:
        if not bool(hist.iloc[i][col]):
            i += 1
            continue
        entry_i = i + 1
        if entry_i >= n:
            break
        entry_date = hist.index[entry_i]
        if from_date and str(pd.Timestamp(entry_date).date()) < from_date:
            i += 1
            continue
        entry_px = float(hist.iloc[entry_i]["open"])
        if not np.isfinite(entry_px) or entry_px <= 0:
            i += 1
            continue

        row = hist.iloc[i]
        exit_i = None
        exit_reason = "end_of_data"
        for j in range(entry_i, n):
            held = j - entry_i
            hit, reason = _should_exit(exit_mode, hist, j, entry_i)
            if hit:
                exit_i = j + 1 if j + 1 < n else j
                exit_reason = reason
                break
            if held >= max_hold_bars:
                exit_i = j
                exit_reason = "max_hold"
                break
        if exit_i is None:
            exit_i = n - 1
        if exit_i <= entry_i:
            i = entry_i + 1
            continue

        exit_px = float(hist.iloc[exit_i]["open"])
        if exit_reason == "end_of_data":
            exit_px = float(hist.iloc[exit_i]["close"])
        ret = (exit_px / entry_px) - 1.0
        trades.append(
            Trade(
                ticker=ticker,
                alert=f"{entry_key}->{exit_mode}",
                entry_date=str(pd.Timestamp(entry_date).date()),
                exit_date=str(pd.Timestamp(hist.index[exit_i]).date()),
                entry_price=round(entry_px, 4),
                exit_price=round(exit_px, 4),
                bars_held=int(exit_i - entry_i),
                return_pct=round(ret * 100, 2),
                entry_rank=int(row["quality_rank"]),
                entry_convergence=int(row["convergence"]),
                exit_reason=exit_reason,
            )
        )
        i = exit_i + 1
    return trades


def run_matrix(
    tickers: list[str],
    start: str,
    from_date: str,
    entries: list[str],
    exits: list[str],
    out_json: Path | None = None,
) -> list[dict]:
    histories: dict[str, pd.DataFrame] = {}
    for t in tickers:
        print(f"Building radar history for {t}...", flush=True)
        try:
            ohlcv = download_ohlcv(t, start)
            histories[t] = enrich_entry_flags(build_radar_history(ohlcv))
        except Exception as exc:
            print(f"  SKIP {t}: {exc}")

    rows: list[dict] = []
    print("\n" + "=" * 100)
    print("TREND RADAR ENTRY × EXIT MATRIX")
    print("=" * 100)
    print(
        f"{'Entry':<22} {'Exit':<14} {'N':>4} {'Win%':>6} {'Avg%':>7} "
        f"{'Med%':>7} {'Sum%':>8} {'Hold':>5} {'Best':>7} {'Worst':>7}"
    )

    for entry in entries:
        for exit_mode in exits:
            trades: list[Trade] = []
            for t, hist in histories.items():
                trades.extend(
                    simulate_entry_exit(
                        t, hist, entry, exit_mode, from_date=from_date
                    )
                )
            s = summarize(trades)
            row = {
                "entry": entry,
                "exit": exit_mode,
                "entry_meta": ENTRY_CATALOG.get(entry, {}),
                "exit_meta": EXIT_CATALOG.get(exit_mode, {}),
                **s,
            }
            rows.append(row)
            print(
                f"{entry:<22} {exit_mode:<14} {s['n_trades']:4d} "
                f"{s['win_rate']*100:5.1f}% {s.get('avg_return_pct', 0):7.2f} "
                f"{s.get('median_return_pct', 0):7.2f} {s.get('total_return_pct_sum', 0):8.2f} "
                f"{s.get('avg_bars_held', 0):5.1f} "
                f"{s.get('best_trade_pct', 0):7.2f} {s.get('worst_trade_pct', 0):7.2f}"
            )

    # Rank by expectancy proxy: median return, then win rate, require n>=8
    ranked = sorted(
        [r for r in rows if r["n_trades"] >= 8],
        key=lambda r: (r.get("median_return_pct", 0), r["win_rate"], r.get("avg_return_pct", 0)),
        reverse=True,
    )
    print("\n" + "=" * 100)
    print("TOP COMBOS (n>=8, ranked by median return → win rate)")
    print("=" * 100)
    for i, r in enumerate(ranked[:10], 1):
        print(
            f"{i:2d}. {r['entry']} → {r['exit']}  "
            f"n={r['n_trades']} win={r['win_rate']*100:.0f}% "
            f"med={r.get('median_return_pct', 0):+.2f}% avg={r.get('avg_return_pct', 0):+.2f}% "
            f"hold={r.get('avg_bars_held', 0):.0f}d"
        )

    if out_json is not None:
        out_json.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "filters": {"tickers": tickers, "start": start, "from_date": from_date},
            "entry_catalog": ENTRY_CATALOG,
            "exit_catalog": EXIT_CATALOG,
            "matrix": rows,
            "top": ranked[:10],
        }
        out_json.write_text(json.dumps(payload, indent=2))
        print(f"\nWrote {out_json}")
    return rows


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--tickers", default="SPY,AAPL,MSFT,JPM,XOM")
    p.add_argument("--start", default="2020-01-01")
    p.add_argument("--from-date", default="2023-01-01")
    p.add_argument(
        "--out",
        default="pipeline/research/artifacts/radar_signal_matrix.json",
    )
    args = p.parse_args(argv)
    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    entries = list(ENTRY_CATALOG.keys())
    exits = list(EXIT_CATALOG.keys())
    run_matrix(
        tickers,
        args.start,
        args.from_date,
        entries,
        exits,
        out_json=Path(args.out),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
