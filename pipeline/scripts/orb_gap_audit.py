"""Read-only ORB gap scan audit (matches compute.opening_range daily screen).

Usage:
    python -m pipeline.scripts.orb_gap_audit
    python -m pipeline.scripts.orb_gap_audit --session 2026-10-12
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import date
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

from pipeline.compute.opening_range import (
    GAP_PCT,
    LIQUID,
    MAX_NAMES,
    _flatten_daily,
    _session_from_daily,
    gap_pct,
)
from pipeline.utils.supabase import fetch_all

load_dotenv()
load_dotenv(".env.local")


def _sb():
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(url, key)


def scan_gaps(tickers: list[str], session: date) -> dict:
    import yfinance as yf

    try:
        raw = yf.download(
            tickers,
            period="10d",
            interval="1d",
            auto_adjust=False,
            progress=False,
            group_by="ticker",
            threads=True,
        )
    except Exception as exc:
        return {"error": str(exc), "frames": {}, "session": session}

    frames = _flatten_daily(raw, tickers)
    inferred = _session_from_daily(frames) or session
    if inferred != session:
        session = inferred

    rows: list[dict] = []
    no_frame = 0
    short_history = 0
    missing_ohlc = 0
    below_thresh: list[dict] = []

    for sym in tickers:
        df = frames.get(sym)
        if df is None or df.empty:
            no_frame += 1
            continue
        if len(df) < 2:
            short_history += 1
            continue
        cols = {str(c).title(): c for c in df.columns}
        close_c = cols.get("Close") or cols.get("Adj Close")
        open_c = cols.get("Open")
        if close_c is None or open_c is None:
            missing_ohlc += 1
            continue
        sess_rows = df[pd.Series(df.index.date, index=df.index) <= session]
        if len(sess_rows) < 2:
            short_history += 1
            continue
        prev = sess_rows.iloc[-2]
        cur = sess_rows.iloc[-1]
        prev_close = float(prev[close_c])
        open_px = float(cur[open_c])
        last_px = float(cur[close_c])
        g = gap_pct(prev_close, open_px)
        if g is None:
            continue
        row = {
            "symbol": sym,
            "gapPct": round(g, 4),
            "prevClose": round(prev_close, 4),
            "open": round(open_px, 4),
            "last": round(last_px, 4),
        }
        if abs(g) >= GAP_PCT:
            rows.append(row)
        elif abs(g) >= GAP_PCT - 1.0:
            below_thresh.append(row)

    rows.sort(key=lambda r: abs(r["gapPct"]), reverse=True)
    below_thresh.sort(key=lambda r: abs(r["gapPct"]), reverse=True)
    top_watch = rows[:MAX_NAMES]

    return {
        "session": session.isoformat(),
        "gapThresholdPct": GAP_PCT,
        "tickersRequested": len(tickers),
        "framesWithData": len(frames),
        "noDailyFrame": no_frame,
        "shortHistory": short_history,
        "missingOhlc": missing_ohlc,
        "gappersAtThreshold": len(rows),
        "gappersInWatchCap": len(top_watch),
        "topGappers": rows[:25],
        "nearMiss": below_thresh[:15],
        "watchSymbols": [r["symbol"] for r in top_watch],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="ORB gap scan audit")
    parser.add_argument("--session", type=str, default="", help="YYYY-MM-DD (default: infer from yfinance)")
    parser.add_argument(
        "--out",
        type=str,
        default="/opt/cursor/artifacts/orb-gap-audit.json",
        help="JSON output path",
    )
    args = parser.parse_args()
    session = date.fromisoformat(args.session) if args.session else date.today()

    sb = _sb()
    uni = fetch_all(
        sb,
        "universe_members",
        "symbol",
        filters=lambda q: q.eq("is_active", True),
    )
    tickers = sorted(set(LIQUID) | {r["symbol"] for r in uni if r.get("symbol")})

    audit = scan_gaps(tickers, session)

    runs = fetch_all(
        sb,
        "orb_runs",
        "run_id, session_date, names, breakouts, headline, computed_at",
        order=("computed_at", True),
    )
    latest = runs[0] if runs else None
    watch = fetch_all(sb, "orb_watch", "symbol, gap_pct, status, run_id, or_high, or_low")
    prod_watch = []
    if latest:
        rid = latest["run_id"]
        prod_watch = [w for w in watch if w.get("run_id") == rid]

    report = {
        "audit": audit,
        "production": {
            "latestRun": latest,
            "watchRows": prod_watch,
        },
        "match": {
            "watchSymbolsMatch": sorted(audit.get("watchSymbols") or [])
            == sorted([w["symbol"] for w in prod_watch]),
            "auditWatch": audit.get("watchSymbols"),
            "prodWatch": [w["symbol"] for w in prod_watch],
        },
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
