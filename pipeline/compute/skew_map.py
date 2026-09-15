"""Options skew map + weekend-vol — what listed traders are paying for.

Pulls yfinance option chains, builds:

  - skew slice   IV vs strike at each expiry (OTM put / OTM call)
  - term         ATM IV vs calendar DTE
  - surface      moneyness × DTE grid
  - weekend vol  implied variance between the nearest Friday expiry and
                 the following Monday expiry (calendar clock vs closed
                 weekend). Also stores a 365/252 trading-day rescale of
                 front ATM IV.

Black-Scholes time is calendar days. Saturday and Sunday add clock time
with no trading session, so a Friday→Monday pair isolates the weekend
variance the market is actually charging.

Not investment advice. Yahoo IV is a listed mid inversion, not a vol
surface calibrated to a model book.

Usage:
    python -m pipeline.compute.skew_map
"""
from __future__ import annotations

import logging
import math
import os
import time
from datetime import date, datetime, timezone

from dotenv import load_dotenv

from pipeline.clients.option_chain import fetch_symbol, skew_universe
from pipeline.utils.supabase import fetch_all

load_dotenv()
load_dotenv(".env.local")
logger = logging.getLogger(__name__)

TRADING_DAY_SCALE = math.sqrt(365.0 / 252.0)


def _sb():
    from pipeline.utils.client import get_supabase
    return get_supabase()



def weekend_from_term(term: list[dict]) -> dict | None:
    """Implied weekend variance from the nearest Friday → next Monday pair.

    var(T) = IV² × T, T = max(DTE, 0.5) / 365
    var_weekend = var(Monday) − var(Friday)
    weekend_iv  = sign(var_weekend) × sqrt(|var_weekend| / (Δcal / 365))

    A ratio > 1 means the weekend is richer per calendar day than Friday ATM.
    """
    usable = [t for t in term if t.get("atmIv") is not None and t.get("dte") is not None]
    fridays = [t for t in usable if t.get("weekday") == 4 and t["dte"] >= 0]
    mondays = [t for t in usable if t.get("weekday") == 0 and t["dte"] >= 0]
    if not fridays or not mondays:
        return None
    fri = min(fridays, key=lambda t: t["dte"])
    later = [
        m for m in mondays
        if m["expiry"] > fri["expiry"] and (m["dte"] - fri["dte"]) <= 5
    ]
    if not later:
        return None
    mon = min(later, key=lambda t: t["dte"])

    t_f = max(float(fri["dte"]), 0.5) / 365.0
    t_m = max(float(mon["dte"]), 0.5) / 365.0
    var_f = (float(fri["atmIv"]) ** 2) * t_f
    var_m = (float(mon["atmIv"]) ** 2) * t_m
    var_w = var_m - var_f
    cal_days = max(float(mon["dte"] - fri["dte"]), 1.0)
    mag = math.sqrt(abs(var_w) / (cal_days / 365.0))
    weekend_iv = mag if var_w >= 0 else -mag
    fri_iv = float(fri["atmIv"])
    ratio = weekend_iv / fri_iv if fri_iv else None
    share = (var_w / var_m) if var_m else None
    return {
        "fridayExpiry": fri["expiry"],
        "fridayDte": fri["dte"],
        "fridayIv": round(fri_iv, 6),
        "mondayExpiry": mon["expiry"],
        "mondayDte": mon["dte"],
        "mondayIv": round(float(mon["atmIv"]), 6),
        "calendarDays": int(cal_days),
        "varFriday": round(var_f, 8),
        "varMonday": round(var_m, 8),
        "varWeekend": round(var_w, 8),
        "weekendIv": round(weekend_iv, 6),
        "weekendRatio": None if ratio is None else round(ratio, 4),
        "weekendVarShare": None if share is None else round(share, 4),
        "note": (
            "Calendar-time variance between Friday and Monday expiry. "
            "Markets are closed Sat/Sun, so a ratio above 1 is weekend event "
            "premium; below 1 means the weekend is cheap vs weekday clock time."
        ),
    }


def metrics_from_payload(payload: dict) -> dict:
    term = payload.get("term") or []
    front = next((t for t in term if t.get("atmIv") is not None), None)
    atm = front.get("atmIv") if front else None
    put_iv = front.get("putIv") if front else None
    call_iv = front.get("callIv") if front else None
    put_skew = (put_iv - atm) if put_iv is not None and atm is not None else None
    call_skew = (call_iv - atm) if call_iv is not None and atm is not None else None
    rr = (put_iv - call_iv) if put_iv is not None and call_iv is not None else None
    fly = None
    if atm is not None and put_iv is not None and call_iv is not None:
        fly = (put_iv + call_iv) / 2 - atm

    back = None
    if front:
        target = front["dte"] + 60
        farther = [t for t in term if t.get("atmIv") is not None and t["dte"] >= target]
        back = min(farther, key=lambda t: t["dte"]) if farther else (
            max((t for t in term if t.get("atmIv") is not None), key=lambda t: t["dte"], default=None)
        )
    term_slope = None
    if front and back and back is not front and front.get("atmIv") is not None and back.get("atmIv") is not None:
        term_slope = float(back["atmIv"]) - float(front["atmIv"])

    wknd = weekend_from_term(term)
    iv_trading = (atm * TRADING_DAY_SCALE) if atm is not None else None

    return {
        "spot": payload.get("spot"),
        "atmIv": atm,
        "ivTrading": None if iv_trading is None else round(iv_trading, 6),
        "frontDte": front.get("dte") if front else None,
        "frontExpiry": front.get("expiry") if front else None,
        "putSkew": None if put_skew is None else round(put_skew, 6),
        "callSkew": None if call_skew is None else round(call_skew, 6),
        "riskReversal": None if rr is None else round(rr, 6),
        "butterfly": None if fly is None else round(fly, 6),
        "termSlope": None if term_slope is None else round(term_slope, 6),
        "weekendIv": None if not wknd else wknd["weekendIv"],
        "weekendRatio": None if not wknd else wknd["weekendRatio"],
        "weekendVarShare": None if not wknd else wknd["weekendVarShare"],
        "nExpiries": len(term),
        "weekend": wknd,
    }


def _company_names(sb) -> dict[str, str]:
    try:
        rows = fetch_all(sb, "universe_members", "symbol, company_name")
    except Exception:
        logger.exception("universe_members lookup failed")
        return {}
    return {r["symbol"]: r.get("company_name") or "" for r in rows if r.get("symbol")}


def _headline(rows: list[dict], asof: date) -> str:
    if not rows:
        return f"{asof.isoformat()} skew map empty — yfinance returned no chains."
    richest = max(rows, key=lambda r: abs(r.get("weekend_ratio") or 0))
    fattest = max(rows, key=lambda r: r.get("put_skew") or -999)
    wr = richest.get("weekend_ratio")
    ps = fattest.get("put_skew")
    wr_s = f"{wr:.2f}×" if wr is not None else "—"
    ps_s = f"{(ps or 0) * 100:+.1f} vol-pts" if ps is not None else "—"
    return (
        f"{asof.isoformat()} · {len(rows)} names · "
        f"weekend richest {richest['symbol']} ({wr_s} Fri ATM) · "
        f"fattest put skew {fattest['symbol']} ({ps_s})"
    )


def run() -> dict:
    today = date.today()
    run_id = f"skew-{today.isoformat()}-{datetime.now(timezone.utc).strftime('%H%M%S')}"
    symbols = skew_universe()
    logger.info("=== Skew map start · %d tickers · %s ===", len(symbols), today.isoformat())

    sb = _sb()
    names = _company_names(sb)
    rows: list[dict] = []
    log: list[str] = []

    for i, sym in enumerate(symbols):
        logger.info("fetching %s (%d/%d)", sym, i + 1, len(symbols))
        try:
            payload = fetch_symbol(sym, today)
        except Exception:
            logger.exception("%s: fetch failed", sym)
            log.append(f"FAIL {sym} fetch")
            continue
        if not payload:
            log.append(f"SKIP {sym} no chain")
            continue
        m = metrics_from_payload(payload)
        row = {
            "symbol": sym,
            "run_id": run_id,
            "company_name": names.get(sym) or None,
            "spot": m["spot"],
            "atm_iv": m["atmIv"],
            "iv_trading": m["ivTrading"],
            "front_dte": m["frontDte"],
            "front_expiry": m["frontExpiry"],
            "put_skew": m["putSkew"],
            "call_skew": m["callSkew"],
            "risk_reversal": m["riskReversal"],
            "butterfly": m["butterfly"],
            "term_slope": m["termSlope"],
            "weekend_iv": m["weekendIv"],
            "weekend_ratio": m["weekendRatio"],
            "weekend_var_share": m["weekendVarShare"],
            "n_expiries": m["nExpiries"],
            "slices": payload.get("slices") or [],
            "term": payload.get("term") or [],
            "surface": payload.get("surface") or [],
            "weekend": m["weekend"],
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }
        rows.append(row)
        atm_s = f"{m['atmIv'] * 100:.1f}%" if m["atmIv"] is not None else "—"
        rr_s = f"{m['riskReversal'] * 100:.1f}" if m["riskReversal"] is not None else "—"
        wr_s = f"{m['weekendRatio']:.2f}" if m["weekendRatio"] is not None else "—"
        log.append(f"OK {sym} ATM={atm_s} RR={rr_s} WKND={wr_s}")
        if i < len(symbols) - 1:
            time.sleep(0.8)

    headline = _headline(rows, today)
    sb.table("skew_runs").upsert({
        "run_id": run_id,
        "asof_date": today.isoformat(),
        "names": len(rows),
        "headline": headline,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }).execute()

    if rows:
        # Replace the snapshot so a failed ticker does not linger from a prior run.
        existing = fetch_all(sb, "skew_names", "symbol")
        keep = {r["symbol"] for r in rows}
        stale = [r["symbol"] for r in existing if r.get("symbol") not in keep]
        for i in range(0, len(rows), 20):
            sb.table("skew_names").upsert(rows[i:i + 20]).execute()
        if stale:
            sb.table("skew_names").delete().in_("symbol", stale).execute()

    logger.info("skew map wrote %d names · %s", len(rows), headline)
    return {"run_id": run_id, "names": len(rows), "headline": headline, "log": log}


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    result = run()
    print(result["headline"])
    for line in result["log"]:
        print(" ", line)


if __name__ == "__main__":
    main()
