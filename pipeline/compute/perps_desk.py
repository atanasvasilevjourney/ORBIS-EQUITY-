"""MODULE 11 — TEMA + Carver paper book on equity-mapped USDT perps.

Separate from LOOP / ORB / BIAS. Signals from `prices_daily`. Sizing as
isolated USDT-M perpetuals (leverage, margin, liq). No live orders.

  TEMA sleeve   50% of $100k · 8/21/55 stack · B+ ranked 3L/3S · 1.5/2.5 ATR
  Carver sleeve 50% of $100k · EWMAC 16/64+32/128 · vol-target 25% · 3x gross cap

Usage:
    python -m pipeline.compute.perps_desk
"""
from __future__ import annotations

import logging
import os
from collections import defaultdict
from datetime import date, datetime, timezone

import numpy as np
from dotenv import load_dotenv
from supabase import create_client

from pipeline.clients.perp_venue import fetch_venue_tape
from pipeline.compute.perps_math import (
    CARVER_GROSS_LEV_CAP,
    CARVER_MIN_ABS,
    CARVER_SLEEVE_FRAC,
    CARVER_TARGET_VOL,
    EQUITY,
    MAX_ATR_PCT,
    MAX_LEVERAGE,
    MIN_ATR_PCT,
    MIN_BARS,
    TEMA_CLUSTER_MAX,
    TEMA_SLEEVE_FRAC,
    TEMA_TOP_LONG,
    TEMA_TOP_SHORT,
    annual_vol,
    blended_carver_forecast,
    carver_notional,
    funding_ann,
    funding_blocks,
    grade_ok,
    perp_contract,
    round_px,
    scale_gross,
    side_weights,
    size_perp,
    tema_notional,
    tema_signal,
    pick_ranked,
    wilder_atr,
)
from pipeline.utils.supabase import fetch_all

load_dotenv()
load_dotenv(".env.local")
logger = logging.getLogger(__name__)


def _sb():
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(url, key)


def _px(v: float | None) -> float | None:
    if v is None:
        return None
    return round_px(float(v))


def run() -> dict:
    today = date.today()
    run_id = f"p-{today.isoformat()}-{datetime.now(timezone.utc).strftime('%H%M%S')}"
    sb = _sb()
    logger.info("=== Perps desk (TEMA + Carver) start ===")

    uni = fetch_all(
        sb, "universe_members",
        "symbol, company_name, sector",
        filters=lambda q: q.eq("is_active", True),
    )
    meta = {
        r["symbol"]: {
            "name": r.get("company_name") or "",
            "sector": r.get("sector") or "Other",
        }
        for r in uni if r.get("symbol")
    }
    prices = fetch_all(
        sb, "prices_daily",
        "symbol, date, open, high, low, close",
        order=("date", False),
    )
    by_sym: dict[str, list[tuple]] = defaultdict(list)
    for p in prices:
        if not p.get("symbol") or p.get("close") is None:
            continue
        by_sym[p["symbol"]].append((
            p["date"],
            float(p.get("open") or p["close"]),
            float(p.get("high") or p["close"]),
            float(p.get("low") or p["close"]),
            float(p["close"]),
        ))

    scanned: list[dict] = []
    for sym, pts in sorted(by_sym.items()):
        pts = sorted(pts)
        if len(pts) < MIN_BARS:
            continue
        close = np.array([x[4] for x in pts], dtype=float)
        high = np.array([x[2] for x in pts], dtype=float)
        low = np.array([x[3] for x in pts], dtype=float)
        last = float(close[-1])
        atr = wilder_atr(high, low, close)
        if atr <= 0:
            continue
        atr_pct = (atr / last) * 100.0
        ts = tema_signal(close, high, low, atr)
        if ts is None:
            continue
        fc, f_fast, f_slow = blended_carver_forecast(close)
        inst_vol = annual_vol(close)
        info = meta.get(sym) or {}
        skip = None
        if atr_pct < MIN_ATR_PCT:
            skip = "atr_quiet"
        elif atr_pct > MAX_ATR_PCT:
            skip = "atr_chaos"
        scanned.append({
            "symbol": sym,
            "company_name": info.get("name") or None,
            "sector": info.get("sector") or "Other",
            "last_px": last,
            "atr": atr,
            "atr_pct": atr_pct,
            "tema": ts,
            "forecast": fc,
            "ewmac_fast": f_fast,
            "ewmac_slow": f_slow,
            "inst_vol": inst_vol,
            "skip_reason": skip,
        })

    if not scanned:
        logger.warning("Perps desk produced 0 names; leaving previous snapshot")
        return {"run_id": None, "names": 0, "headline": "no names", "tema_slots": 0, "carver_slots": 0}

    contracts = [perp_contract(r["symbol"]) for r in scanned]
    tape = fetch_venue_tape(contracts)

    tema_equity = EQUITY * TEMA_SLEEVE_FRAC
    carver_equity = EQUITY * CARVER_SLEEVE_FRAC

    # ── TEMA ranked book (QMIE allocator shape) ─────────────────────────
    eligible = [
        r for r in scanned
        if r["skip_reason"] is None
        and r["tema"].side in ("BUY", "SELL")
        and grade_ok(r["tema"].grade)
    ]
    longs = sorted(
        [r for r in eligible if r["tema"].side == "BUY"],
        key=lambda r: (-r["tema"].score, r["symbol"]),
    )
    shorts = sorted(
        [r for r in eligible if r["tema"].side == "SELL"],
        key=lambda r: (-r["tema"].score, r["symbol"]),
    )
    longs_p = pick_ranked(longs, TEMA_TOP_LONG, TEMA_CLUSTER_MAX, lambda r: r["sector"])
    shorts_p = pick_ranked(shorts, TEMA_TOP_SHORT, TEMA_CLUSTER_MAX, lambda r: r["sector"])
    long_book = 50.0 if longs_p and shorts_p else (100.0 if longs_p else 0.0)
    short_book = 50.0 if longs_p and shorts_p else (100.0 if shorts_p else 0.0)
    lw = side_weights(len(longs_p), long_book)
    sw = side_weights(len(shorts_p), short_book)
    tema_alloc: dict[str, dict] = {}
    for i, r in enumerate(longs_p):
        tema_alloc[r["symbol"]] = {"rank": i + 1, "weight_pct": lw[i], "side": "BUY"}
    for i, r in enumerate(shorts_p):
        tema_alloc[r["symbol"]] = {"rank": i + 1, "weight_pct": sw[i], "side": "SELL"}

    # ── Carver vol-target book ──────────────────────────────────────────
    carver_raw: list[tuple[str, float]] = []
    for r in scanned:
        if r["skip_reason"] is not None:
            continue
        ntl = carver_notional(r["forecast"], carver_equity, r["inst_vol"])
        carver_raw.append((r["symbol"], ntl))
    scaled = scale_gross([n for _, n in carver_raw], carver_equity, CARVER_GROSS_LEV_CAP)
    carver_ntl = {sym: ntl for (sym, _), ntl in zip(carver_raw, scaled)}

    now = datetime.now(timezone.utc).isoformat()
    rows = []
    tema_slots = 0
    carver_slots = 0
    gross = 0.0
    margin_sum = 0.0

    for r in scanned:
        sym = r["symbol"]
        last = r["last_px"]
        ts = r["tema"]
        contract = perp_contract(sym)
        venue_row = tape.get(contract) or tape.get(contract.upper()) or {}
        mark = venue_row.get("mark")
        funding = venue_row.get("funding_8h")
        venue = venue_row.get("venue") or "synthetic"
        listed = bool(venue_row)

        skip = r["skip_reason"]
        ta = tema_alloc.get(sym)
        in_tema = False
        tema_weight = None
        tema_ntl = 0.0
        tema_lev = 0.0
        tema_margin = 0.0
        tema_liq = last
        if ta and skip is None:
            if funding_blocks(ta["side"], funding):
                skip = "funding_against"
            else:
                allocated = tema_equity * (ta["weight_pct"] / 100.0)
                raw_ntl = tema_notional(allocated, last, r["atr"])
                signed = raw_ntl if ta["side"] == "BUY" else -raw_ntl
                sized = size_perp(signed, allocated, last, ta["side"])
                in_tema = abs(sized.notional) > 0
                tema_weight = ta["weight_pct"]
                tema_ntl = sized.notional
                tema_lev = sized.leverage
                tema_margin = sized.margin
                tema_liq = sized.liq
                if in_tema:
                    tema_slots += 1

        in_carver = False
        cv_ntl = 0.0
        cv_lev = 0.0
        cv_margin = 0.0
        cv_liq = last
        cv_side = "FLAT"
        n_carver = sum(1 for v in carver_ntl.values() if abs(v) > 0)
        if skip is None and abs(r["forecast"]) >= CARVER_MIN_ABS:
            cv_side = "BUY" if r["forecast"] > 0 else "SELL"
            if funding_blocks(cv_side, funding):
                skip = skip or "funding_against"
            else:
                raw = carver_ntl.get(sym, 0.0)
                allocated = carver_equity / max(1, n_carver)
                sized = size_perp(raw, allocated, last, cv_side)
                cv_ntl = sized.notional
                cv_lev = sized.leverage
                cv_margin = sized.margin
                cv_liq = sized.liq
                in_carver = abs(cv_ntl) > 0
                if in_carver:
                    carver_slots += 1

        gross += abs(tema_ntl) + abs(cv_ntl)
        margin_sum += tema_margin + cv_margin

        bits = []
        if ts.side != "FLAT":
            bits.append(f"TEMA {ts.side} {ts.grade} ({ts.score:.0f}) stack {ts.strength:.2f} ATR")
        else:
            bits.append("TEMA flat (8/21/55 not stacked)")
        bits.append(f"Carver forecast {r['forecast']:+.1f} (16/64 {r['ewmac_fast']:+.1f}, 32/128 {r['ewmac_slow']:+.1f})")
        bits.append(f"σ {r['inst_vol']*100:.0f}%")
        if listed:
            bits.append(f"{venue} {contract} listed")
        else:
            bits.append(f"{contract} synthetic — no venue tape from this host")
        if skip:
            bits.append(f"skip {skip}")
        rationale = " · ".join(bits) + ". Paper perp — not a live order."

        rows.append({
            "symbol": sym,
            "run_id": run_id,
            "company_name": r["company_name"],
            "sector": r["sector"],
            "last_px": _px(last),
            "perp_symbol": contract,
            "venue": venue,
            "venue_listed": listed,
            "mark_px": _px(mark) if mark is not None else None,
            "funding_8h": funding,
            "funding_ann": funding_ann(funding),
            "tema_side": ts.side,
            "tema_grade": ts.grade,
            "tema_score": ts.score,
            "tema_t8": _px(ts.t8),
            "tema_t21": _px(ts.t21),
            "tema_t55": _px(ts.t55),
            "tema_stop": _px(ts.stop),
            "tema_tp": _px(ts.take_profit),
            "tema_weight_pct": tema_weight,
            "tema_notional": round(tema_ntl, 2),
            "tema_leverage": tema_lev,
            "tema_margin": round(tema_margin, 2),
            "tema_liq": _px(tema_liq),
            "carver_forecast": round(r["forecast"], 2),
            "carver_ewmac_fast": round(r["ewmac_fast"], 2),
            "carver_ewmac_slow": round(r["ewmac_slow"], 2),
            "carver_vol": round(r["inst_vol"], 4) if r["inst_vol"] else None,
            "carver_side": cv_side,
            "carver_notional": round(cv_ntl, 2),
            "carver_leverage": cv_lev,
            "carver_margin": round(cv_margin, 2),
            "carver_liq": _px(cv_liq),
            "atr": _px(r["atr"]),
            "atr_pct": round(r["atr_pct"], 3),
            "in_tema_book": in_tema,
            "in_carver_book": in_carver,
            "skip_reason": skip,
            "rationale": rationale,
            "computed_at": now,
        })

    gross_lev = gross / EQUITY if EQUITY else 0.0
    listed_n = sum(1 for r in rows if r["venue_listed"])
    headline = (
        f"{today.isoformat()} · {len(rows)} names · TEMA {tema_slots} slots · "
        f"Carver {carver_slots} slots · gross {gross_lev:.2f}x · "
        f"{listed_n} venue-listed / {len(rows) - listed_n} synthetic"
    )
    config = {
        "equity": EQUITY,
        "temaSleeve": TEMA_SLEEVE_FRAC,
        "carverSleeve": CARVER_SLEEVE_FRAC,
        "temaFast": 8,
        "temaMid": 21,
        "temaSlow": 55,
        "temaSlAtr": 1.5,
        "temaTpAtr": 2.5,
        "temaMinGrade": "B",
        "topLong": TEMA_TOP_LONG,
        "topShort": TEMA_TOP_SHORT,
        "clusterMax": TEMA_CLUSTER_MAX,
        "carverTargetVol": CARVER_TARGET_VOL,
        "carverGrossLevCap": CARVER_GROSS_LEV_CAP,
        "maxLeverage": MAX_LEVERAGE,
        "minAtrPct": MIN_ATR_PCT,
        "maxAtrPct": MAX_ATR_PCT,
    }
    sb.table("perp_runs").upsert({
        "run_id": run_id,
        "asof_date": today.isoformat(),
        "names": len(rows),
        "tema_slots": tema_slots,
        "carver_slots": carver_slots,
        "gross_leverage": round(gross_lev, 4),
        "headline": headline,
        "config": config,
        "computed_at": now,
    }).execute()

    existing = fetch_all(sb, "perp_names", "symbol")
    keep = {r["symbol"] for r in rows}
    stale = [r["symbol"] for r in existing if r.get("symbol") not in keep]
    for i in range(0, len(rows), 40):
        sb.table("perp_names").upsert(rows[i:i + 40]).execute()
    for i in range(0, len(stale), 40):
        sb.table("perp_names").delete().in_("symbol", stale[i:i + 40]).execute()

    logger.info("Perps desk wrote %d names · %s", len(rows), headline)
    return {
        "run_id": run_id,
        "names": len(rows),
        "headline": headline,
        "tema_slots": tema_slots,
        "carver_slots": carver_slots,
        "gross_leverage": gross_lev,
    }


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    print(run()["headline"])


if __name__ == "__main__":
    main()
