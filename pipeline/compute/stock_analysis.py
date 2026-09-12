"""Stock analysis module — technical indicators + fundamental overlay.

Ports MorcilloSanz/stockanalysis (long-term MA/regression + mid-term
MACD/RSI/volume decision tree) onto KovaView `prices_daily`, then joins
composite factor score and Piotroski F-Score from the fundamentals snapshot.

Usage:
    python -m pipeline.compute.stock_analysis
"""
from __future__ import annotations

import logging
import os
from collections import defaultdict
from datetime import date, datetime, timezone

import numpy as np
from dotenv import load_dotenv
from supabase import create_client

from pipeline.compute.tech_signals import (
    CODE_BUY,
    CODE_HOLD,
    CODE_SELL,
    EMA,
    MACD,
    RSI,
    SMA,
    decision_tree_signal,
    linear_regression,
    macd_signal_mid_term,
    moving_averages_signal_mid_term,
    rsi_signal_mid_term,
    signal_linear_regression,
    signal_moving_averages_long_term,
)
from pipeline.utils.supabase import fetch_all

load_dotenv()
load_dotenv(".env.local")
logger = logging.getLogger(__name__)

CODE_LABEL = {CODE_BUY: "BUY", CODE_SELL: "SELL", CODE_HOLD: "HOLD"}


def _sb():
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(url, key)


def _last(arr: np.ndarray) -> float | None:
    if arr is None or len(arr) == 0:
        return None
    v = float(arr[-1])
    return v if np.isfinite(v) else None


def analyze_series(close: np.ndarray, volume: np.ndarray) -> dict | None:
    if close is None or len(close) < 60:
        return None
    close = np.asarray(close, dtype=float)
    volume = np.asarray(volume, dtype=float)
    if np.any(~np.isfinite(close)):
        mask = np.isfinite(close)
        close, volume = close[mask], volume[mask]
        if len(close) < 60:
            return None

    smooth_long = SMA(close, 100) if len(close) >= 100 else SMA(close, min(50, len(close)))
    m, n = linear_regression(smooth_long)
    sma50 = SMA(close, 50)
    sma100 = SMA(close, 100)
    sma200 = SMA(close, 200)
    ema20 = EMA(close, 20)
    ema50 = EMA(close, 50)
    ema100 = EMA(close, 100)
    macd_line, _, _ = MACD(close)
    rsi = RSI(close)

    close_d = float(np.gradient(smooth_long)[-1])
    vol_smooth = SMA(volume, 20) if len(volume) >= 20 else volume
    vol_d = float(np.gradient(vol_smooth)[-1]) if len(vol_smooth) else 0.0

    lr_c, lr_d = signal_linear_regression(m)
    long_c, long_d = signal_moving_averages_long_term(sma100, sma200, ema50, ema100, close)
    mid_c, mid_d = moving_averages_signal_mid_term(sma50, sma100, ema20, ema50, close)
    dt_c, dt_d = decision_tree_signal(close_d, vol_d)
    macd_c, macd_desc = macd_signal_mid_term(macd_line)
    rsi_c, rsi_d = rsi_signal_mid_term(rsi)

    codes = [lr_c, long_c, mid_c, dt_c, macd_c, rsi_c]
    buys = sum(1 for c in codes if c == CODE_BUY)
    sells = sum(1 for c in codes if c == CODE_SELL)
    holds = sum(1 for c in codes if c == CODE_HOLD)
    if buys > sells and buys >= 2:
        vote = "BUY"
    elif sells > buys and sells >= 2:
        vote = "SELL"
    else:
        vote = "HOLD"

    spark_n = min(80, len(close))
    spark = {
        "close": [round(float(x), 4) for x in close[-spark_n:]],
        "sma50": [None if not np.isfinite(x) else round(float(x), 4) for x in sma50[-spark_n:]],
        "ema20": [None if not np.isfinite(x) else round(float(x), 4) for x in ema20[-spark_n:]],
    }
    return {
        "last": _last(close),
        "sma50": _last(sma50),
        "sma100": _last(sma100),
        "sma200": _last(sma200),
        "ema20": _last(ema20),
        "ema50": _last(ema50),
        "ema100": _last(ema100),
        "macd": _last(macd_line),
        "rsi": _last(rsi),
        "lr_m": round(m, 6),
        "lr_code": lr_c,
        "lr_desc": lr_d,
        "mavg_long_code": long_c,
        "mavg_long_desc": long_d,
        "mavg_mid_code": mid_c,
        "mavg_mid_desc": mid_d,
        "dt_code": dt_c,
        "dt_desc": dt_d,
        "macd_code": macd_c,
        "macd_desc": macd_desc,
        "rsi_code": rsi_c,
        "rsi_desc": rsi_d,
        "vote": vote,
        "buy_count": buys,
        "sell_count": sells,
        "hold_count": holds,
        "spark": spark,
    }


def run() -> dict:
    today = date.today()
    run_id = f"an-{today.isoformat()}-{datetime.now(timezone.utc).strftime('%H%M%S')}"
    sb = _sb()
    logger.info("=== Stock analysis start ===")

    uni = fetch_all(sb, "universe_members", "symbol, company_name",
                    filters=lambda q: q.eq("is_active", True))
    names = {r["symbol"]: r.get("company_name") or "" for r in uni if r.get("symbol")}
    prices = fetch_all(
        sb, "prices_daily", "symbol, date, close, volume",
        order=("date", False),
    )
    by_sym: dict[str, list] = defaultdict(list)
    for p in prices:
        if p.get("close") is None:
            continue
        by_sym[p["symbol"]].append(p)

    funds = {
        r["symbol"]: r
        for r in fetch_all(
            sb, "fundamentals_snapshot",
            "symbol, composite_factor_score, f_score, pe_ratio",
        )
        if r.get("symbol")
    }

    rows: list[dict] = []
    for sym, pts in by_sym.items():
        pts = sorted(pts, key=lambda r: r["date"])
        close = np.array([float(p["close"]) for p in pts], dtype=float)
        vol = np.array([float(p["volume"] or 0) for p in pts], dtype=float)
        result = analyze_series(close, vol)
        if not result:
            continue
        f = funds.get(sym) or {}
        rows.append({
            "symbol": sym,
            "run_id": run_id,
            "company_name": names.get(sym) or None,
            "last_px": result["last"],
            "sma50": result["sma50"],
            "sma100": result["sma100"],
            "sma200": result["sma200"],
            "ema20": result["ema20"],
            "ema50": result["ema50"],
            "ema100": result["ema100"],
            "macd": result["macd"],
            "rsi": result["rsi"],
            "lr_m": result["lr_m"],
            "lr_code": result["lr_code"],
            "lr_desc": result["lr_desc"],
            "mavg_long_code": result["mavg_long_code"],
            "mavg_long_desc": result["mavg_long_desc"],
            "mavg_mid_code": result["mavg_mid_code"],
            "mavg_mid_desc": result["mavg_mid_desc"],
            "dt_code": result["dt_code"],
            "dt_desc": result["dt_desc"],
            "macd_code": result["macd_code"],
            "macd_desc": result["macd_desc"],
            "rsi_code": result["rsi_code"],
            "rsi_desc": result["rsi_desc"],
            "vote": result["vote"],
            "buy_count": result["buy_count"],
            "sell_count": result["sell_count"],
            "hold_count": result["hold_count"],
            "composite_score": f.get("composite_factor_score"),
            "f_score": f.get("f_score"),
            "pe_ratio": f.get("pe_ratio"),
            "spark": result["spark"],
            "computed_at": datetime.now(timezone.utc).isoformat(),
        })

    buys = sum(1 for r in rows if r["vote"] == "BUY")
    sells = sum(1 for r in rows if r["vote"] == "SELL")
    top = max(rows, key=lambda r: (r["buy_count"], r.get("composite_score") or 0), default=None)
    headline = (
        f"{today.isoformat()} · {len(rows)} names · {buys} BUY / {sells} SELL · "
        f"strongest {top['symbol'] if top else '—'} ({top['buy_count'] if top else 0}/6)"
    )
    sb.table("analysis_runs").upsert({
        "run_id": run_id,
        "asof_date": today.isoformat(),
        "names": len(rows),
        "buys": buys,
        "sells": sells,
        "headline": headline,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }).execute()

    existing = fetch_all(sb, "analysis_names", "symbol")
    keep = {r["symbol"] for r in rows}
    stale = [r["symbol"] for r in existing if r.get("symbol") not in keep]
    if rows:
        for i in range(0, len(rows), 40):
            sb.table("analysis_names").upsert(rows[i:i + 40]).execute()
    if stale:
        sb.table("analysis_names").delete().in_("symbol", stale).execute()

    logger.info("analysis wrote %d names · %s", len(rows), headline)
    return {"run_id": run_id, "names": len(rows), "buys": buys, "sells": sells, "headline": headline}


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    print(run()["headline"])


if __name__ == "__main__":
    main()
