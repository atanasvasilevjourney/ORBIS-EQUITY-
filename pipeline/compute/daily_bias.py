"""Daily bias desk — key levels + paper trade ideas on listed names.

Discord-style daily-bias card, built from KovaView data we actually have:

  Levels    classic floor pivots from prior day, swing high/low, SMA 20/50,
            prior high/low, optional 15m OR from orb_watch
  Range     last close ± 0.75 × ATR(14)
  Bias      ANALYZE majority vote (fallback: close vs SMA50 + RSI + MACD)
  Ideas     fade to S1/R1 and break of prior high/low, 1R+ ATR stops

No GEX, no absorption lots, no MaxSell walls — we do not have that tape.
Paper analytics. Not investment advice.

Usage:
    python -m pipeline.compute.daily_bias
"""
from __future__ import annotations

import logging
import os
from collections import defaultdict
from datetime import date, datetime, timezone

import numpy as np
from dotenv import load_dotenv
from supabase import create_client

from pipeline.compute.tech_signals import MACD, RSI
from pipeline.utils.supabase import fetch_all

load_dotenv()
load_dotenv(".env.local")
logger = logging.getLogger(__name__)

MIN_BARS = 60
ATR_N = 14
RR_MIN = 1.2


def _sb():
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(url, key)


def _px(v: float) -> float:
    av = abs(v)
    if av >= 1000:
        return round(v, 1)
    if av >= 100:
        return round(v, 2)
    if av >= 10:
        return round(v, 2)
    return round(v, 4)


def trail_sma(close: np.ndarray, period: int) -> float:
    """Trailing SMA — matches the chart overlay, not the centered ANALYZE low-pass."""
    if len(close) == 0:
        return 0.0
    w = close[-period:] if len(close) >= period else close
    return float(np.mean(w))


def wilder_atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = ATR_N) -> float:
    if len(close) < period + 1:
        tr = high - low
        return float(np.nanmean(tr[-period:])) if len(tr) else 0.0
    prev = close[:-1]
    h, l, c = high[1:], low[1:], close[1:]
    tr = np.maximum(h - l, np.maximum(np.abs(h - prev), np.abs(l - prev)))
    atr = float(np.mean(tr[:period]))
    for x in tr[period:]:
        atr = (atr * (period - 1) + float(x)) / period
    return float(atr)


def classic_pivots(h: float, l: float, c: float) -> dict[str, float]:
    pp = (h + l + c) / 3.0
    r1 = 2 * pp - l
    s1 = 2 * pp - h
    r2 = pp + (h - l)
    s2 = pp - (h - l)
    return {"pp": pp, "r1": r1, "s1": s1, "r2": r2, "s2": s2}


def swing_levels(high: np.ndarray, low: np.ndarray, n: int = 5, lookback: int = 40) -> tuple[float | None, float | None]:
    """Most recent swing high / low in the last `lookback` bars."""
    if len(high) < n * 2 + 3:
        return None, None
    start = max(n, len(high) - lookback)
    sh = sl = None
    for i in range(start, len(high) - n):
        w_h = high[i - n : i + n + 1]
        w_l = low[i - n : i + n + 1]
        if high[i] >= w_h.max() - 1e-12:
            sh = float(high[i])
        if low[i] <= w_l.min() + 1e-12:
            sl = float(low[i])
    return sh, sl


def _rr(entry: float, target: float, stop: float, side: str) -> float | None:
    risk = (entry - stop) if side == "LONG" else (stop - entry)
    reward = (target - entry) if side == "LONG" else (entry - target)
    if risk <= 1e-9 or reward <= 0:
        return None
    return reward / risk


def _idea(n: int, side: str, entry: float, target: float, stop: float, kind: str, last: float, atr: float) -> dict | None:
    entry, target, stop = _px(entry), _px(target), _px(stop)
    if side == "LONG" and not (stop < entry < target):
        return None
    if side == "SHORT" and not (target < entry < stop):
        return None
    rr = _rr(entry, target, stop, side)
    if rr is None or rr < RR_MIN:
        return None
    # Skip if entry is more than 2 ATR from last (not a same-session idea)
    if atr > 0 and abs(entry - last) > 2.0 * atr:
        return None
    return {
        "id": n,
        "side": side,
        "entry": entry,
        "target": target,
        "stop": stop,
        "rr": round(rr, 2),
        "kind": kind,
        "label": f"idea {n}: {side} @ {_px(entry)} -> {_px(target)}, stop {_px(stop)}",
    }


def _confidence(vote: str, buy: int, sell: int) -> str:
    lead = buy if vote == "BUY" else sell if vote == "SELL" else max(buy, sell)
    if lead >= 4:
        return "high"
    if lead == 3:
        return "medium"
    return "low"


def build_card(
    close: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    *,
    vote: str | None = None,
    buy_count: int = 0,
    sell_count: int = 0,
    or_high: float | None = None,
    or_low: float | None = None,
    macd_desc: str | None = None,
    rsi_desc: str | None = None,
    mavg_desc: str | None = None,
) -> dict | None:
    if len(close) < MIN_BARS:
        return None
    last = float(close[-1])
    # Last completed EOD bar *is* the prior session for the next open.
    prior_h, prior_l = float(high[-1]), float(low[-1])
    atr = wilder_atr(high, low, close)
    if atr <= 0:
        return None
    piv = classic_pivots(prior_h, prior_l, last)
    sma20_l = trail_sma(close, 20)
    sma50_l = trail_sma(close, 50)
    rsi = RSI(close)
    macd_line, _, _ = MACD(close)
    rsi_l = float(rsi[-1]) if np.isfinite(rsi[-1]) else 50.0
    macd_l = float(macd_line[-1]) if np.isfinite(macd_line[-1]) else 0.0
    sh, sl = swing_levels(high, low)

    vote = (vote or "").upper() or None
    if vote not in ("BUY", "SELL", "HOLD"):
        score = 0
        if last > sma50_l:
            score += 1
        else:
            score -= 1
        if macd_l > 0:
            score += 1
        else:
            score -= 1
        if rsi_l < 30:
            score += 1
        elif rsi_l > 70:
            score -= 1
        vote = "BUY" if score > 0 else "SELL" if score < 0 else "HOLD"
        buy_count = max(buy_count, 1 if vote == "BUY" else 0)
        sell_count = max(sell_count, 1 if vote == "SELL" else 0)

    if vote == "BUY":
        bias = "LONG"
    elif vote == "SELL":
        bias = "SHORT"
    else:
        bias = "NEUTRAL"
    conf = _confidence(vote, buy_count, sell_count)

    range_lo = _px(last - 0.75 * atr)
    range_hi = _px(last + 0.75 * atr)

    levels = [
        {"price": _px(piv["r2"]), "label": "R2", "kind": "pivot"},
        {"price": _px(piv["r1"]), "label": "R1 / prior supply", "kind": "pivot"},
        {"price": _px(piv["pp"]), "label": "Pivot", "kind": "pivot"},
        {"price": _px(piv["s1"]), "label": "S1 / prior demand", "kind": "pivot"},
        {"price": _px(piv["s2"]), "label": "S2", "kind": "pivot"},
        {"price": _px(prior_h), "label": "Prior high", "kind": "session"},
        {"price": _px(prior_l), "label": "Prior low", "kind": "session"},
        {"price": _px(sma20_l), "label": "SMA 20", "kind": "ma"},
        {"price": _px(sma50_l), "label": "SMA 50", "kind": "ma"},
    ]
    if sh:
        levels.append({"price": _px(sh), "label": "Swing high", "kind": "swing"})
    if sl:
        levels.append({"price": _px(sl), "label": "Swing low", "kind": "swing"})
    if or_high:
        levels.append({"price": _px(or_high), "label": "OR high", "kind": "or"})
    if or_low:
        levels.append({"price": _px(or_low), "label": "OR low", "kind": "or"})

    # Dedup levels within 0.15 ATR
    levels.sort(key=lambda x: -x["price"])
    compact: list[dict] = []
    for lv in levels:
        if any(abs(lv["price"] - c["price"]) < 0.15 * atr for c in compact):
            continue
        compact.append(lv)
    levels = compact[:10]

    longs: list[dict] = []
    shorts: list[dict] = []
    if bias in ("LONG", "NEUTRAL"):
        fade_entry = piv["s1"] if sl is None or abs(piv["s1"] - last) < abs(sl - last) else sl
        idea = _idea(1, "LONG", fade_entry, piv["pp"] if piv["pp"] > fade_entry else fade_entry + atr, fade_entry - 0.75 * atr, "fade S1", last, atr)
        if idea:
            longs.append(idea)
        brk = _idea(1, "LONG", prior_h, prior_h + atr, prior_h - 0.5 * atr, "break prior high", last, atr)
        if brk:
            longs.append(brk)
    if bias in ("SHORT", "NEUTRAL"):
        fade_entry = piv["r1"] if sh is None or abs(piv["r1"] - last) < abs(sh - last) else sh
        idea = _idea(1, "SHORT", fade_entry, piv["pp"] if piv["pp"] < fade_entry else fade_entry - atr, fade_entry + 0.75 * atr, "fade R1", last, atr)
        if idea:
            shorts.append(idea)
        brk = _idea(1, "SHORT", prior_l, prior_l - atr, prior_l + 0.5 * atr, "break prior low", last, atr)
        if brk:
            shorts.append(brk)
    if bias == "NEUTRAL":
        ideas = longs[:1] + shorts[:1]
    elif bias == "LONG":
        ideas = longs[:2]
    else:
        ideas = shorts[:2]
    for i, idea in enumerate(ideas, start=1):
        idea["id"] = i
        idea["label"] = f"idea {i}: {idea['side']} @ {idea['entry']} -> {idea['target']}, stop {idea['stop']}"

    scenarios = [
        {"dir": "up", "text": f"IF reclaim above {_px(piv['r1'])} -> {_px(piv['r2'])} extension"},
        {"dir": "down", "text": f"IF breakdown below {_px(piv['s1'])} -> {_px(piv['s2'])} target"},
    ]

    bits = []
    if vote:
        bits.append(f"ANALYZE {vote} ({buy_count} buy / {sell_count} sell)")
    bits.append(f"RSI {rsi_l:.0f}")
    bits.append("close above SMA50" if last > sma50_l else "close below SMA50")
    bits.append("MACD +" if macd_l > 0 else "MACD −")
    if macd_desc and macd_desc != "no signal detected":
        bits.append(macd_desc)
    if rsi_desc and rsi_desc != "no signal detected":
        bits.append(rsi_desc)
    if mavg_desc and mavg_desc != "no signal detected":
        bits.append(mavg_desc)
    bits.append(f"ATR { _px(atr) } · expected range {_px(range_lo)}–{_px(range_hi)}")
    rationale = " · ".join(bits) + ". Pivots from prior session. Paper idea — not a live order."

    return {
        "last_px": _px(last),
        "bias": bias,
        "confidence": conf,
        "vote": vote,
        "buy_count": buy_count,
        "sell_count": sell_count,
        "atr": _px(atr),
        "rsi": round(rsi_l, 1),
        "sma20": _px(sma20_l),
        "sma50": _px(sma50_l),
        "range_lo": range_lo,
        "range_hi": range_hi,
        "levels": levels,
        "ideas": ideas,
        "scenarios": scenarios,
        "rationale": rationale,
    }


def run() -> dict:
    today = date.today()
    run_id = f"b-{today.isoformat()}-{datetime.now(timezone.utc).strftime('%H%M%S')}"
    sb = _sb()
    logger.info("=== Daily bias start ===")

    uni = fetch_all(sb, "universe_members", "symbol, company_name", filters=lambda q: q.eq("is_active", True))
    names = {r["symbol"]: r.get("company_name") or "" for r in uni if r.get("symbol")}
    analysis = {r["symbol"]: r for r in fetch_all(sb, "analysis_names", "*") if r.get("symbol")}
    orb = {r["symbol"]: r for r in fetch_all(sb, "orb_watch", "symbol, or_high, or_low") if r.get("symbol")}
    prices = fetch_all(sb, "prices_daily", "symbol, date, open, high, low, close", order=("date", False))
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

    rows = []
    for sym, pts in sorted(by_sym.items()):
        pts = sorted(pts)
        if len(pts) < MIN_BARS:
            continue
        close = np.array([x[4] for x in pts], dtype=float)
        high = np.array([x[2] for x in pts], dtype=float)
        low = np.array([x[3] for x in pts], dtype=float)
        an = analysis.get(sym) or {}
        ow = orb.get(sym) or {}
        card = build_card(
            close, high, low,
            vote=an.get("vote"),
            buy_count=int(an.get("buy_count") or 0),
            sell_count=int(an.get("sell_count") or 0),
            or_high=ow.get("or_high"),
            or_low=ow.get("or_low"),
            macd_desc=an.get("macd_desc"),
            rsi_desc=an.get("rsi_desc"),
            mavg_desc=an.get("mavg_mid_desc"),
        )
        if not card:
            continue
        rows.append({
            "symbol": sym,
            "run_id": run_id,
            "company_name": names.get(sym) or None,
            **card,
            "computed_at": datetime.now(timezone.utc).isoformat(),
        })

    if not rows:
        logger.warning("Daily bias produced 0 names; leaving previous snapshot")
        return {"run_id": None, "names": 0, "headline": "no names", "longs": 0, "shorts": 0}

    longs = sum(1 for r in rows if r["bias"] == "LONG")
    shorts = sum(1 for r in rows if r["bias"] == "SHORT")
    headline = f"{today.isoformat()} · {len(rows)} names · {longs} LONG / {shorts} SHORT · ATR pivots, paper ideas"
    sb.table("bias_runs").upsert({
        "run_id": run_id,
        "asof_date": today.isoformat(),
        "names": len(rows),
        "longs": longs,
        "shorts": shorts,
        "headline": headline,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }).execute()

    existing = fetch_all(sb, "bias_names", "symbol")
    keep = {r["symbol"] for r in rows}
    stale = [r["symbol"] for r in existing if r.get("symbol") not in keep]
    for i in range(0, len(rows), 40):
        sb.table("bias_names").upsert(rows[i:i + 40]).execute()
    for i in range(0, len(stale), 40):
        sb.table("bias_names").delete().in_("symbol", stale[i:i + 40]).execute()

    logger.info("Daily bias wrote %d names · %s", len(rows), headline)
    return {"run_id": run_id, "names": len(rows), "headline": headline, "longs": longs, "shorts": shorts}


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    print(run()["headline"])


if __name__ == "__main__":
    main()
