"""Opening range breakout — paper harness (Zheng / hackingthemarkets long-only).

Faithful port of `michaelzheng67/Full-Stack-Stock-Algorithm` without Alpaca:

  1. Screen gappers: |open / prev_close − 1| ≥ 4%
  2. Opening range = 09:30–09:45 America/New_York on 5-minute bars
  3. Long trigger: first 5m close after 09:45 above OR high
  4. Bracket: take-profit = entry + OR, stop = entry − OR (1R)
  5. Size: floor((equity × 5%) / price)  — original buying-power rule

Paper only. No live broker orders. Not investment advice.

Usage:
    python -m pipeline.compute.opening_range
"""
from __future__ import annotations

import logging
import math
import os
import time
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf
from dotenv import load_dotenv
from supabase import create_client

from pipeline.utils.supabase import fetch_all

load_dotenv()
load_dotenv(".env.local")
logger = logging.getLogger(__name__)

NY = ZoneInfo("America/New_York")
GAP_PCT = float(os.getenv("ORB_GAP_PCT", "4"))  # percent, original default
OR_START_MIN = 9 * 60 + 30
OR_END_MIN = 9 * 60 + 45
EQUITY = 100_000.0
RISK_FRAC = 0.05  # 5% of equity per name (original)
MAX_NAMES = 8
MIN_PRICE = 2.0
LIQUID = [
    "SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "TSLA", "AMD", "META", "AMZN",
    "GOOGL", "NFLX", "AVGO", "AMAT", "MU", "INTC", "BA", "DIS", "UBER", "COIN",
    "MSTR", "PLTR", "SOFI", "RIVN", "NIO", "GME", "HOOD", "SMCI", "ARM", "SHOP",
]


def _sb():
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(url, key)


def _minutes(ts: pd.Timestamp) -> int:
    t = ts.tz_convert(NY) if ts.tzinfo else ts.tz_localize(NY)
    return t.hour * 60 + t.minute


def opening_range(bars: pd.DataFrame, session: date) -> dict | None:
    """Compute 15-minute OR and first close-above-high breakout.

    `bars` must have Open/High/Low/Close (any case) and a tz-aware index.
    """
    if bars is None or bars.empty:
        return None
    df = bars.copy()
    df.columns = [str(c).title() for c in df.columns]
    if "Close" not in df.columns or "High" not in df.columns:
        return None
    idx = df.index
    if idx.tz is None:
        idx = idx.tz_localize("UTC")
    idx = idx.tz_convert(NY)
    df = df.copy()
    df.index = idx
    day = df[df.index.date == session]
    if day.empty:
        return None
    mins = pd.Series([_minutes(t) for t in day.index], index=day.index)
    or_bars = day[(mins >= OR_START_MIN) & (mins < OR_END_MIN)]
    after = day[(mins >= OR_END_MIN) & (mins < 16 * 60)]
    if or_bars.empty:
        return {
            "orHigh": None, "orLow": None, "orRange": None,
            "status": "NO_BARS", "entry": None, "breakoutAt": None,
            "last": float(day["Close"].iloc[-1]) if not day.empty else None,
            "bars": _bar_payload(or_bars, after),
        }
    or_high = float(or_bars["High"].max())
    or_low = float(or_bars["Low"].min())
    or_range = or_high - or_low
    last = float(day["Close"].iloc[-1])
    payload = _bar_payload(or_bars, after)
    brk = after[after["Close"] > or_high] if not after.empty else after
    if brk is None or brk.empty:
        return {
            "orHigh": or_high, "orLow": or_low, "orRange": or_range,
            "status": "NO_BREAK", "entry": None, "breakoutAt": None,
            "last": last, "bars": payload,
        }
    entry = float(brk["Close"].iloc[0])
    ts = brk.index[0]
    return {
        "orHigh": or_high, "orLow": or_low, "orRange": or_range,
        "status": "BREAKOUT", "entry": entry,
        "breakoutAt": ts.tz_convert("UTC").isoformat(),
        "last": last, "bars": payload,
    }


def _bar_payload(or_bars: pd.DataFrame, after: pd.DataFrame) -> list[dict]:
    rows = []
    for part, tag in ((or_bars, "OR"), (after.head(24), "AFTER")):
        if part is None or part.empty:
            continue
        for ts, r in part.iterrows():
            rows.append({
                "t": ts.tz_convert("UTC").isoformat(),
                "o": round(float(r.get("Open", r.get("Close", 0))), 4),
                "h": round(float(r["High"]), 4),
                "l": round(float(r["Low"]), 4),
                "c": round(float(r["Close"]), 4),
                "tag": tag,
            })
    return rows


def gap_pct(prev_close: float, open_px: float) -> float | None:
    if not prev_close or prev_close <= 0 or open_px is None:
        return None
    return (open_px / prev_close - 1.0) * 100.0


def _flatten_daily(raw: pd.DataFrame, tickers: list[str]) -> dict[str, pd.DataFrame]:
    out: dict[str, pd.DataFrame] = {}
    if raw is None or raw.empty:
        return out
    if isinstance(raw.columns, pd.MultiIndex):
        # yfinance group_by='ticker' or default field-first
        level0 = set(raw.columns.get_level_values(0))
        if any(t in level0 for t in tickers):
            for t in tickers:
                if t in level0:
                    out[t] = raw[t].dropna(how="all")
        else:
            for t in tickers:
                try:
                    sub = raw.xs(t, axis=1, level=1).dropna(how="all")
                    if not sub.empty:
                        out[t] = sub
                except KeyError:
                    continue
    else:
        if len(tickers) == 1:
            out[tickers[0]] = raw
    return out


def _session_from_daily(frames: dict[str, pd.DataFrame]) -> date | None:
    latest: date | None = None
    for df in frames.values():
        if df is None or df.empty:
            continue
        d = pd.Timestamp(df.index[-1]).date()
        if latest is None or d > latest:
            latest = d
    return latest


def _fetch_5m(symbol: str) -> pd.DataFrame:
    df = yf.download(
        symbol, period="5d", interval="5m", auto_adjust=False,
        progress=False, threads=False,
    )
    if df is None or df.empty:
        return pd.DataFrame()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[0] for c in df.columns]
    return df


def run() -> dict:
    today = date.today()
    run_id = f"orb-{today.isoformat()}-{datetime.now(timezone.utc).strftime('%H%M%S')}"
    sb = _sb()

    uni = fetch_all(sb, "universe_members", "symbol, company_name",
                    filters=lambda q: q.eq("is_active", True))
    names = {r["symbol"]: r.get("company_name") or "" for r in uni if r.get("symbol")}
    tickers = sorted(set(LIQUID) | set(names.keys()))

    logger.info("=== ORB start · scan %d names · gap ≥ %.1f%% ===", len(tickers), GAP_PCT)
    try:
        raw = yf.download(
            tickers, period="10d", interval="1d", auto_adjust=False,
            progress=False, group_by="ticker", threads=True,
        )
    except Exception:
        logger.exception("daily batch download failed")
        raw = pd.DataFrame()
    frames = _flatten_daily(raw, tickers)
    session = _session_from_daily(frames) or today

    gappers: list[dict] = []
    for sym, df in frames.items():
        if df is None or len(df) < 2:
            continue
        cols = {str(c).title(): c for c in df.columns}
        close_c = cols.get("Close") or cols.get("Adj Close")
        open_c = cols.get("Open")
        if close_c is None or open_c is None:
            continue
        # last row = session, previous close = prior row
        sess_rows = df[pd.Series(df.index.date, index=df.index) <= session]
        if len(sess_rows) < 2:
            continue
        prev = sess_rows.iloc[-2]
        cur = sess_rows.iloc[-1]
        prev_close = float(prev[close_c])
        open_px = float(cur[open_c])
        last_px = float(cur[close_c])
        g = gap_pct(prev_close, open_px)
        if g is None or abs(g) < GAP_PCT:
            continue
        if open_px < MIN_PRICE:
            continue
        gappers.append({
            "symbol": sym,
            "gap": g,
            "prevClose": prev_close,
            "open": open_px,
            "last": last_px,
        })

    gappers.sort(key=lambda r: abs(r["gap"]), reverse=True)
    gappers = gappers[:MAX_NAMES]
    logger.info("gappers this session (%s): %d", session.isoformat(), len(gappers))

    watch: list[dict] = []
    orders: list[dict] = []
    for i, g in enumerate(gappers):
        sym = g["symbol"]
        try:
            bars = _fetch_5m(sym)
            rng = opening_range(bars, session) if bars is not None else None
        except Exception:
            logger.exception("%s 5m fetch failed", sym)
            rng = None
        if rng is None:
            rng = {"orHigh": None, "orLow": None, "orRange": None, "status": "NO_BARS",
                   "entry": None, "breakoutAt": None, "last": g["last"], "bars": []}
        status = rng["status"]
        entry = rng["entry"]
        or_range = rng["orRange"]
        shares = None
        stop = None
        tp = None
        if status == "BREAKOUT" and entry and or_range and or_range > 0:
            shares = math.floor((EQUITY * RISK_FRAC) / entry)
            if shares < 1:
                status = "NO_BREAK"
                shares = None
            else:
                stop = entry - or_range
                tp = entry + or_range
                orders.append({
                    "id": f"{run_id}-{sym}",
                    "run_id": run_id,
                    "ticker": sym,
                    "action": "BUY",
                    "type": "ENTER",
                    "shares": shares,
                    "limit_price": round(entry, 4),
                    "stop_price": round(stop, 4),
                    "take_profit": round(tp, 4),
                    "reason": (
                        f"ORB long · gap {g['gap']:+.1f}% · "
                        f"OR {rng['orLow']:.2f}-{rng['orHigh']:.2f} · "
                        f"close above {rng['orHigh']:.2f}"
                    ),
                })
        last = rng.get("last") or g["last"]
        r_mult = None
        if status == "BREAKOUT" and entry and or_range and or_range > 0 and last:
            r_mult = (last - entry) / or_range
        watch.append({
            "symbol": sym,
            "run_id": run_id,
            "company_name": names.get(sym) or None,
            "gap_pct": round(g["gap"], 4),
            "prev_close": round(g["prevClose"], 4),
            "open_px": round(g["open"], 4),
            "or_high": None if rng["orHigh"] is None else round(rng["orHigh"], 4),
            "or_low": None if rng["orLow"] is None else round(rng["orLow"], 4),
            "or_range": None if or_range is None else round(or_range, 4),
            "status": status,
            "entry": None if entry is None else round(entry, 4),
            "stop": None if stop is None else round(stop, 4),
            "take_profit": None if tp is None else round(tp, 4),
            "shares": shares,
            "breakout_at": rng.get("breakoutAt"),
            "last_px": None if last is None else round(float(last), 4),
            "r_multiple": None if r_mult is None else round(float(r_mult), 4),
            "bars": rng.get("bars") or [],
            "computed_at": datetime.now(timezone.utc).isoformat(),
        })
        if i < len(gappers) - 1:
            time.sleep(0.25)

    n_brk = sum(1 for w in watch if w["status"] == "BREAKOUT")
    top = watch[0]["symbol"] if watch else "—"
    headline = (
        f"{session.isoformat()} · {len(watch)} gappers (≥{GAP_PCT:.0f}%) · "
        f"{n_brk} ORB longs · top |gap| {top}"
    )
    sb.table("orb_runs").upsert({
        "run_id": run_id,
        "asof_date": today.isoformat(),
        "session_date": session.isoformat(),
        "names": len(watch),
        "breakouts": n_brk,
        "headline": headline,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }).execute()

    existing = fetch_all(sb, "orb_watch", "symbol")
    keep = {w["symbol"] for w in watch}
    stale = [r["symbol"] for r in existing if r.get("symbol") not in keep]
    if watch:
        sb.table("orb_watch").upsert(watch).execute()
    if stale:
        sb.table("orb_watch").delete().in_("symbol", stale).execute()
    if orders:
        sb.table("orb_orders").upsert(orders, on_conflict="id").execute()
        # drop orders from older runs that are not in this snapshot
        old = fetch_all(sb, "orb_orders", "id, run_id")
        drop = [r["id"] for r in old if r.get("run_id") != run_id]
        if drop:
            sb.table("orb_orders").delete().in_("id", drop).execute()
    else:
        old = fetch_all(sb, "orb_orders", "id")
        if old:
            sb.table("orb_orders").delete().in_("id", [r["id"] for r in old]).execute()

    logger.info("ORB wrote %d watch / %d breakouts · %s", len(watch), n_brk, headline)
    return {"run_id": run_id, "names": len(watch), "breakouts": n_brk, "headline": headline}


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    result = run()
    print(result["headline"])


if __name__ == "__main__":
    main()
