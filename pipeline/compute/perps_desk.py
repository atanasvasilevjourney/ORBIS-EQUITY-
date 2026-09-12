"""MODULE 11 — TEMA + Carver paper book on cash-market stocks.

Separate from LOOP / ORB / BIAS / ROTATE. Signals and size from
`prices_daily` (listed close). Fully funded cash shares — no USDT-M
leverage, funding, or liquidation. No live broker orders.

  TEMA sleeve   50% of $100k · 9/99/199 swing · MACD(12,26,9) close · B+ 3L/3S · 2.5 ATR stop
  Carver sleeve 50% of $100k · EWMAC + vol-target + DD scalar · LIVE/REDUCE/CASH

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

from pipeline.compute.perps_math import (
    CASH_GROSS_CAP,
    CARVER_MIN_ABS,
    CARVER_REDUCE_TOP,
    CARVER_SLEEVE_FRAC,
    CARVER_TARGET_VOL,
    EQUITY,
    MAX_ATR_PCT,
    MIN_ATR_PCT,
    MIN_BARS,
    TEMA_CLUSTER_MAX,
    TEMA_FAST,
    TEMA_MID,
    TEMA_SLOW,
    MACD_FAST,
    MACD_SIGNAL,
    MACD_SLOW,
    TEMA_SLEEVE_FRAC,
    TEMA_SL_ATR,
    TEMA_TP_ATR,
    TEMA_TOP_LONG,
    TEMA_TOP_SHORT,
    annual_vol,
    blended_carver_forecast,
    carver_notional,
    drawdown_scalar,
    equal_weight_equity,
    peak_drawdown_current,
    rotation_regime,
    rotation_size_mult,
    round_px,
    scale_gross,
    side_weights,
    size_cash,
    tema_book_eligible,
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
    logger.info("=== Cash desk (TEMA + Carver) start ===")

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
            "close": close,
        })

    if not scanned:
        logger.warning("Cash desk produced 0 names; leaving previous snapshot")
        return {"run_id": None, "names": 0, "headline": "no names", "tema_slots": 0, "carver_slots": 0}

    tema_equity = EQUITY * TEMA_SLEEVE_FRAC
    carver_equity = EQUITY * CARVER_SLEEVE_FRAC

    # ── Carver drawdown overlay (equal-weight universe equity) ──────────
    ew = equal_weight_equity([r["close"] for r in scanned])
    current_dd, max_dd = peak_drawdown_current(ew)
    dd_s = drawdown_scalar(current_dd)
    n_active = sum(
        1 for r in scanned
        if r["skip_reason"] is None and abs(r["forecast"]) >= CARVER_MIN_ABS
    )
    regime = rotation_regime(dd_s, n_active)
    rot_mult = rotation_size_mult(regime)
    risk_mult = dd_s * rot_mult

    # ── TEMA ranked swing book ──────────────────────────────────────────
    eligible = [
        r for r in scanned
        if tema_book_eligible(r["tema"], r["skip_reason"])
    ]
    longs = sorted(
        [r for r in eligible if r["tema"].side == "BUY"],
        key=lambda r: (-r["tema"].score, r["symbol"]),
    )
    shorts = sorted(
        [r for r in eligible if r["tema"].side == "SELL"],
        key=lambda r: (-r["tema"].score, r["symbol"]),
    )
    top_l = TEMA_TOP_LONG
    top_s = TEMA_TOP_SHORT
    if regime == "REDUCE":
        top_l = min(top_l, CARVER_REDUCE_TOP)
        top_s = min(top_s, CARVER_REDUCE_TOP)
    if regime == "CASH":
        longs_p, shorts_p = [], []
    else:
        longs_p = pick_ranked(longs, top_l, TEMA_CLUSTER_MAX, lambda r: r["sector"])
        shorts_p = pick_ranked(shorts, top_s, TEMA_CLUSTER_MAX, lambda r: r["sector"])
    long_book = 50.0 if longs_p and shorts_p else (100.0 if longs_p else 0.0)
    short_book = 50.0 if longs_p and shorts_p else (100.0 if shorts_p else 0.0)
    lw = side_weights(len(longs_p), long_book)
    sw = side_weights(len(shorts_p), short_book)
    tema_alloc: dict[str, dict] = {}
    for i, r in enumerate(longs_p):
        tema_alloc[r["symbol"]] = {"rank": i + 1, "weight_pct": lw[i], "side": "BUY"}
    for i, r in enumerate(shorts_p):
        tema_alloc[r["symbol"]] = {"rank": i + 1, "weight_pct": sw[i], "side": "SELL"}

    # ── Carver vol-target book, then rotate ─────────────────────────────
    carver_raw: list[tuple[str, float]] = []
    for r in scanned:
        if r["skip_reason"] is not None or regime == "CASH":
            carver_raw.append((r["symbol"], 0.0))
            continue
        ntl = carver_notional(r["forecast"], carver_equity, r["inst_vol"], dd_scalar=risk_mult)
        carver_raw.append((r["symbol"], ntl))
    if regime == "REDUCE":
        ranked = sorted(carver_raw, key=lambda x: -abs(x[1]))
        keep = {sym for sym, ntl in ranked[:CARVER_REDUCE_TOP] if abs(ntl) > 0}
        carver_raw = [(sym, ntl if sym in keep else 0.0) for sym, ntl in carver_raw]
    scaled = scale_gross([n for _, n in carver_raw], carver_equity, CASH_GROSS_CAP * max(risk_mult, 1e-9))
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

        skip = r["skip_reason"]
        ta = tema_alloc.get(sym)
        in_tema = False
        tema_weight = None
        tema_ntl = 0.0
        tema_shares = 0.0
        tema_cash = 0.0
        if ta and skip is None:
            allocated = tema_equity * (ta["weight_pct"] / 100.0)
            raw_ntl = tema_notional(allocated, last, r["atr"]) * risk_mult
            signed = raw_ntl if ta["side"] == "BUY" else -raw_ntl
            sized = size_cash(signed, allocated, last, ta["side"])
            in_tema = abs(sized.notional) > 0
            tema_weight = ta["weight_pct"]
            tema_ntl = sized.notional
            tema_shares = sized.shares
            tema_cash = sized.cash
            if in_tema:
                tema_slots += 1

        in_carver = False
        cv_ntl = 0.0
        cv_shares = 0.0
        cv_cash = 0.0
        cv_side = "FLAT"
        n_carver = sum(1 for v in carver_ntl.values() if abs(v) > 0)
        if skip is None and abs(r["forecast"]) >= CARVER_MIN_ABS:
            cv_side = "BUY" if r["forecast"] > 0 else "SELL"
            raw = carver_ntl.get(sym, 0.0)
            allocated = carver_equity / max(1, n_carver)
            sized = size_cash(raw, allocated, last, cv_side)
            cv_ntl = sized.notional
            cv_shares = sized.shares
            cv_cash = sized.cash
            in_carver = abs(cv_ntl) > 0
            if in_carver:
                carver_slots += 1

        gross += abs(tema_ntl) + abs(cv_ntl)
        margin_sum += tema_cash + cv_cash

        if skip is None and ts.side in ("BUY", "SELL") and ts.macd_action == "CLOSE" and not in_tema:
            skip = "macd_close"

        bits = []
        if ts.side != "FLAT":
            bits.append(f"TEMA 9/99/199 {ts.side} {ts.grade} ({ts.score:.0f}) fan {ts.strength:.2f} ATR · {ts.warmup}")
        else:
            bits.append(f"TEMA 9/99/199 flat ({ts.warmup} warmup)")
        bits.append(
            f"MACD 12/26/9 {ts.macd:+.3f}/{ts.macd_signal:+.3f} hist {ts.macd_hist:+.3f} → {ts.macd_action}"
        )
        bits.append(f"Carver forecast {r['forecast']:+.1f} (16/64 {r['ewmac_fast']:+.1f}, 32/128 {r['ewmac_slow']:+.1f})")
        bits.append(f"σ {r['inst_vol']*100:.0f}% · regime {regime} · DD {current_dd*100:.1f}% · scalar {dd_s:.2f}")
        bits.append(f"cash {last:.2f} · paper shares, no borrow model")
        if skip:
            bits.append(f"skip {skip}")
        rationale = " · ".join(bits) + ". Paper cash book — not a live order."

        rows.append({
            "symbol": sym,
            "run_id": run_id,
            "company_name": r["company_name"],
            "sector": r["sector"],
            "last_px": _px(last),
            "perp_symbol": sym,
            "venue": "cash",
            "venue_listed": True,
            "mark_px": _px(last),
            "funding_8h": None,
            "funding_ann": None,
            "tema_side": ts.side,
            "tema_grade": ts.grade,
            "tema_score": ts.score,
            "tema_t8": _px(ts.t_fast),   # TEMA 9
            "tema_t21": _px(ts.t_mid),   # TEMA 99
            "tema_t55": _px(ts.t_slow),  # TEMA 199
            "tema_stop": _px(ts.stop),
            "tema_tp": _px(ts.take_profit),
            "macd": round(ts.macd, 6),
            "macd_signal": round(ts.macd_signal, 6),
            "macd_hist": round(ts.macd_hist, 6),
            "macd_action": ts.macd_action,
            "tema_weight_pct": tema_weight,
            "tema_notional": round(tema_ntl, 2),
            "tema_leverage": 1.0 if in_tema else 0.0,
            "tema_margin": round(tema_cash, 2),
            "tema_liq": None,
            "tema_shares": tema_shares,
            "carver_forecast": round(r["forecast"], 2),
            "carver_ewmac_fast": round(r["ewmac_fast"], 2),
            "carver_ewmac_slow": round(r["ewmac_slow"], 2),
            "carver_vol": round(r["inst_vol"], 4) if r["inst_vol"] else None,
            "carver_side": cv_side,
            "carver_notional": round(cv_ntl, 2),
            "carver_leverage": 1.0 if in_carver else 0.0,
            "carver_margin": round(cv_cash, 2),
            "carver_liq": None,
            "carver_shares": cv_shares,
            "atr": _px(r["atr"]),
            "atr_pct": round(r["atr_pct"], 3),
            "in_tema_book": in_tema,
            "in_carver_book": in_carver,
            "skip_reason": skip,
            "rationale": rationale,
            "computed_at": now,
        })

    deployed_frac = gross / EQUITY if EQUITY else 0.0
    headline = (
        f"{today.isoformat()} · {len(rows)} names · cash close · "
        f"TEMA 9/99/199 + MACD close {tema_slots} slots · "
        f"Carver {carver_slots} slots · {regime} · DD {current_dd*100:.1f}% "
        f"(scalar {dd_s:.2f}) · deployed ${gross:,.0f} ({deployed_frac*100:.0f}% of $100k)"
    )
    config = {
        "equity": EQUITY,
        "temaSleeve": TEMA_SLEEVE_FRAC,
        "carverSleeve": CARVER_SLEEVE_FRAC,
        "temaFast": TEMA_FAST,
        "temaMid": TEMA_MID,
        "temaSlow": TEMA_SLOW,
        "temaSlAtr": TEMA_SL_ATR,
        "temaTpAtr": TEMA_TP_ATR,
        "macdFast": MACD_FAST,
        "macdSlow": MACD_SLOW,
        "macdSignal": MACD_SIGNAL,
        "temaMinGrade": "B",
        "topLong": TEMA_TOP_LONG,
        "topShort": TEMA_TOP_SHORT,
        "clusterMax": TEMA_CLUSTER_MAX,
        "carverTargetVol": CARVER_TARGET_VOL,
        "cashGrossCap": CASH_GROSS_CAP,
        "book": "cash",
        "minAtrPct": MIN_ATR_PCT,
        "maxAtrPct": MAX_ATR_PCT,
        "regime": regime,
        "drawdown": round(current_dd, 4),
        "maxDrawdown": round(max_dd, 4),
        "ddScalar": round(dd_s, 4),
        "riskMult": round(risk_mult, 4),
        "activeForecasts": n_active,
        "deployed": round(gross, 2),
    }
    sb.table("perp_runs").upsert({
        "run_id": run_id,
        "asof_date": today.isoformat(),
        "names": len(rows),
        "tema_slots": tema_slots,
        "carver_slots": carver_slots,
        "gross_leverage": round(deployed_frac, 4),
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

    logger.info("Cash desk wrote %d names · %s", len(rows), headline)
    return {
        "run_id": run_id,
        "names": len(rows),
        "headline": headline,
        "tema_slots": tema_slots,
        "carver_slots": carver_slots,
        "gross_leverage": deployed_frac,
        "deployed": gross,
    }


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    print(run()["headline"])


if __name__ == "__main__":
    main()
