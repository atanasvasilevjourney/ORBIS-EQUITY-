"""Donchian + VWAP portfolio harness — LOOP TERMINAL engine.

  Universe   S&P 500 ∪ Nasdaq-100, ex-pharma (active universe_members)
  Entry      Close > 55-day upper Donchian (prior bar) AND close > 20-day rolling VWAP
  Exit       Close < 20-day lower Donchian; full rebalance every REBALANCE_DAYS
  Size       Equal weight: ~equity / TOP_N per name (max 8, max 2 / sector)
  Skip       posture < 50 (no rebalance entries), insufficient history

Writes paper_loop_runs / paper_book / paper_orders. Paper only.

Usage:
    python -m pipeline.compute.portfolio_loop
"""
from __future__ import annotations

import logging
import os
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

from pipeline.compute.donchian_vwap import (
    EQUITY,
    EXIT_CHANNEL,
    MAX_PER_SECTOR,
    MIN_NOTIONAL,
    MIN_PRICE,
    REBALANCE_DAYS,
    TOP_N,
    latest_snapshot,
    prior_bar_snapshot,
)
from pipeline.universe_filters import is_loop_tradable, is_pharma_stock
from pipeline.utils.supabase import fetch_all

load_dotenv()
load_dotenv(".env.local")
logger = logging.getLogger(__name__)

POSTURE_ENTRY_MIN = 50
PRICE_HISTORY_DAYS = 90


def _sb():
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(url, key)


def _parse_date(v) -> date | None:
    if not v:
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _should_rebalance(today: date, last_rebalance: date | None) -> bool:
    if last_rebalance is None:
        return True
    return (today - last_rebalance).days >= REBALANCE_DAYS


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== Portfolio Loop Start (Donchian 55 + VWAP 20) ===")
    sb = _sb()
    today = date.today()
    run_id = f"run_{today.isoformat()}_{datetime.now(timezone.utc).strftime('%H%M%S')}"
    now = datetime.now(timezone.utc).isoformat()
    log: list[dict] = []

    def note(level: str, message: str) -> None:
        log.append({"at": now, "level": level, "message": message})
        logger.info("%s %s", level, message)

    universe = fetch_all(
        sb,
        "universe_members",
        "symbol, company_name, sector, industry, tier, is_active",
        filters=lambda q: q.eq("is_active", True),
    )
    uni = {r["symbol"]: r for r in universe if is_loop_tradable(r)}
    book_rows = fetch_all(sb, "paper_book", "*")
    brief_rows = fetch_all(sb, "daily_brief", "asof_date, inputs")
    prior_runs = fetch_all(
        sb,
        "paper_loop_runs",
        "asof_date, harness",
        order=("computed_at", True),
    )

    posture = 50
    if brief_rows:
        latest = sorted(brief_rows, key=lambda x: str(x.get("asof_date") or ""), reverse=True)[0]
        inputs = latest.get("inputs") or {}
        if isinstance(inputs, dict):
            posture = int(inputs.get("posture_score") or 50)

    last_rebalance: date | None = None
    for pr in reversed(prior_runs or []):
        h = pr.get("harness") or {}
        if isinstance(h, dict) and h.get("lastRebalanceDate"):
            last_rebalance = _parse_date(h["lastRebalanceDate"])
            if last_rebalance:
                break

    do_rebalance = _should_rebalance(today, last_rebalance)
    note(
        "INFO",
        f"Loop start · ${EQUITY:,.0f} · {len(book_rows)} open · posture {posture} · "
        f"rebalance={'yes' if do_rebalance else 'no'}",
    )

    cutoff = (today - timedelta(days=PRICE_HISTORY_DAYS)).isoformat()
    all_px: list[dict] = []
    offset, page = 0, 5000
    while True:
        resp = (
            sb.table("prices_daily")
            .select("symbol,date,open,high,low,close,volume")
            .gte("date", cutoff)
            .order("symbol")
            .order("date")
            .range(offset, offset + page - 1)
            .execute()
        )
        rows = resp.data or []
        all_px.extend(rows)
        if len(rows) < page:
            break
        offset += page

    px_df = pd.DataFrame(all_px) if all_px else pd.DataFrame()
    snapshots: dict[str, dict] = {}
    prior_snaps: dict[str, dict] = {}
    if not px_df.empty:
        for sym, g in px_df.groupby("symbol"):
            if sym not in uni:
                continue
            g = g.sort_values("date")
            snap = latest_snapshot(g)
            if snap:
                snapshots[sym] = snap
            prev = prior_bar_snapshot(g)
            if prev:
                prior_snaps[sym] = prev

    skipped: list[dict] = []

    def skip(ticker: str, reason: str, detail: str, sector: str = "") -> None:
        skipped.append({"ticker": ticker, "sector": sector, "reason": reason, "detail": detail})
        note("SKIP", f"{ticker} · {reason} · {detail}")

    orders: list[dict] = []
    oid = 0

    def add_order(**kw) -> None:
        nonlocal oid
        oid += 1
        orders.append({"id": f"{run_id}_ord_{oid:03d}", "run_id": run_id, **kw})

    held = {p["symbol"]: p for p in book_rows}
    surviving: dict[str, dict] = {}

    # --- 1. Mandatory exits (Donchian lower / policy) ---
    for sym, pos in list(held.items()):
        snap = snapshots.get(sym)
        sector = pos.get("sector") or (uni.get(sym) or {}).get("sector") or ""
        shares = int(pos.get("shares") or 0)
        u_row = uni.get(sym) or pos
        exit_reason = None
        if is_pharma_stock(u_row) or sym not in uni:
            exit_reason = "Universe policy · not in LOOP universe"
        elif snap and snap["exit_signal"]:
            exit_reason = f"Donchian {EXIT_CHANNEL}d low · close {snap['close']:.2f} < channel"
        if exit_reason:
            add_order(
                ticker=sym,
                action="SELL",
                type="EXIT",
                shares=shares,
                limit_price=round(snap["close"], 2) if snap else None,
                reason=exit_reason,
                sector=sector,
                risk_usd=None,
            )
            note("ORDER", f"EXIT {sym} {shares} · {exit_reason}")
            held.pop(sym, None)

    # --- 2. Rebalance: rebuild top-N from prior-bar eligibility ---
    target_syms: list[str] = []
    if do_rebalance:
        if posture < POSTURE_ENTRY_MIN:
            note("WARN", f"Posture {posture} < {POSTURE_ENTRY_MIN} — skip rebalance entries")
        else:
            sector_count: dict[str, int] = defaultdict(int)
            cands: list[tuple[str, float, str]] = []
            for sym, prev in prior_snaps.items():
                if not prev.get("eligible"):
                    continue
                sec = uni[sym].get("sector") or "Unknown"
                cands.append((sym, float(prev["strength"]), sec))
            cands.sort(key=lambda x: -x[1])
            for sym, _, sec in cands:
                if sector_count[sec] >= MAX_PER_SECTOR:
                    skip(sym, "SECTOR_CAP", f"{sec} already {MAX_PER_SECTOR}", sec)
                    continue
                target_syms.append(sym)
                sector_count[sec] += 1
                if len(target_syms) >= TOP_N:
                    break
            note("INFO", f"Rebalance target: {target_syms}")

        # Exit names not in target (rebalance rotation)
        for sym in list(held.keys()):
            if sym in target_syms:
                continue
            pos = held[sym]
            snap = snapshots.get(sym)
            add_order(
                ticker=sym,
                action="SELL",
                type="EXIT",
                shares=int(pos.get("shares") or 0),
                limit_price=round(snap["close"], 2) if snap else None,
                reason="Rebalance · dropped from top basket",
                sector=pos.get("sector") or "",
                risk_usd=None,
            )
            note("ORDER", f"EXIT {sym} · rebalance rotate-out")
            held.pop(sym, None)

    # Keep remaining held into surviving unless we rebuild all on rebalance
    for sym, pos in held.items():
        snap = snapshots.get(sym)
        if not snap:
            continue
        _append_position(
            surviving, sym, pos, snap, uni, run_id, now, today, keep_entry=True,
        )

    # --- 3. Enter / resize target names ---
    if do_rebalance and posture >= POSTURE_ENTRY_MIN and target_syms:
        slot_equity = EQUITY / len(target_syms)
        for sym in target_syms:
            snap = snapshots.get(sym)
            u = uni.get(sym)
            if not snap or not u:
                continue
            sector = u.get("sector") or "Unknown"
            price = float(snap["close"])
            if price < MIN_PRICE:
                skip(sym, "MIN_PRICE", f"price {price}", sector)
                continue
            shares = int(slot_equity // price)
            notional = shares * price
            if shares < 1 or notional < MIN_NOTIONAL:
                skip(sym, "MIN_NOTIONAL", f"shares {shares}", sector)
                continue
            lower = snap.get("lower")
            strength = snap.get("strength") or 0
            reason = f"DC{55}+VWAP{20} str {strength:.3f}"
            existing = sym in surviving
            if existing and surviving[sym]["shares"] == shares:
                continue
            if existing:
                old_sh = surviving[sym]["shares"]
                delta = shares - old_sh
                if delta > 0:
                    add_order(
                        ticker=sym, action="BUY", type="RESIZE", shares=delta,
                        limit_price=round(price, 2), reason=reason, sector=sector, risk_usd=None,
                    )
                elif delta < 0:
                    add_order(
                        ticker=sym, action="SELL", type="RESIZE", shares=-delta,
                        limit_price=round(price, 2), reason=reason, sector=sector, risk_usd=None,
                    )
            else:
                add_order(
                    ticker=sym, action="BUY", type="ENTER", shares=shares,
                    limit_price=round(price, 2), reason=reason, sector=sector, risk_usd=None,
                )
                note("ORDER", f"ENTER {sym} {shares} · {reason}")

            surviving[sym] = _position_row(
                sym, u, snap, shares, price, lower, strength, run_id, now, today, reason,
            )

    surviving_list = list(surviving.values())
    deployed = sum((p["last"] or 0) * p["shares"] for p in surviving_list)
    deployed_pct = deployed / EQUITY if EQUITY else 0

    sector_count = defaultdict(int)
    for p in surviving_list:
        sector_count[p["sector"] or "Unknown"] += 1
    sector_exposure = []
    for sector, cnt in sorted(sector_count.items()):
        mv = sum(
            (p["last"] or 0) * p["shares"]
            for p in surviving_list
            if (p["sector"] or "Unknown") == sector
        )
        sector_exposure.append({
            "sector": sector,
            "exposurePct": round(mv / EQUITY, 4) if EQUITY else 0,
            "capPct": round(MAX_PER_SECTOR / TOP_N, 4),
            "utilizationPct": round(cnt / MAX_PER_SECTOR, 4) if MAX_PER_SECTOR else 0,
            "names": cnt,
        })

    harness = {
        "sectorExposure": sector_exposure,
        "skipped": skipped[:40],
        "lastRebalanceDate": today.isoformat() if do_rebalance else (last_rebalance.isoformat() if last_rebalance else None),
        "config": {
            "engine": "donchian_vwap",
            "entryChannel": 55,
            "exitChannel": 20,
            "vwapWindow": 20,
            "maxNames": TOP_N,
            "maxPerSector": MAX_PER_SECTOR,
            "rebalanceDays": REBALANCE_DAYS,
            "equalWeight": True,
        },
    }

    n_enter = sum(1 for o in orders if o["type"] == "ENTER")
    n_exit = sum(1 for o in orders if o["type"] == "EXIT")
    headline = f"{n_exit} exit · {n_enter} enter · {len(skipped)} skipped · deployed {deployed_pct*100:.1f}%"

    sb.table("paper_loop_runs").upsert({
        "run_id": run_id,
        "asof_date": today.isoformat(),
        "equity": EQUITY,
        "deployed_pct": round(deployed_pct, 4),
        "open_risk_pct": round(deployed_pct, 4),
        "names": len(surviving_list),
        "posture": posture,
        "status": "OK",
        "headline": headline,
        "harness": harness,
        "log": log[-40:],
        "computed_at": now,
    }, on_conflict="run_id").execute()

    existing_syms = {p["symbol"] for p in book_rows}
    new_syms = {p["symbol"] for p in surviving_list}
    for sym in existing_syms - new_syms:
        try:
            sb.table("paper_book").delete().eq("symbol", sym).execute()
        except Exception:
            logger.exception("Failed to delete %s from paper_book", sym)

    if surviving_list:
        sb.table("paper_book").upsert(surviving_list, on_conflict="symbol").execute()

    if orders:
        sb.table("paper_orders").upsert(orders, on_conflict="id").execute()

    note("INFO", f"Loop complete · {headline}")
    logger.info("=== Portfolio Loop Complete: %s ===", headline)


def _position_row(
    sym: str,
    u: dict,
    snap: dict,
    shares: int,
    price: float,
    lower: float | None,
    strength: float,
    run_id: str,
    now: str,
    today: date,
    reason: str,
) -> dict:
    rank_display = min(100, int(round(strength * 1000)))
    return {
        "symbol": sym,
        "run_id": run_id,
        "company_name": u.get("company_name"),
        "side": "LONG",
        "shares": shares,
        "entry": round(price, 2),
        "last": round(price, 2),
        "stop": round(lower, 2) if lower is not None else None,
        "n": None,
        "risk_usd": None,
        "sector": u.get("sector") or "",
        "reason": reason,
        "rank": rank_display,
        "breakout": bool(snap.get("eligible")),
        "green": bool(snap.get("above_vwap")),
        "unrealized_pnl_usd": 0.0,
        "days_held": 0,
        "opened_at": today.isoformat(),
        "updated_at": now,
    }


def _append_position(
    surviving: dict,
    sym: str,
    pos: dict,
    snap: dict,
    uni: dict,
    run_id: str,
    now: str,
    today: date,
    *,
    keep_entry: bool,
) -> None:
    entry = float(pos.get("entry") or snap["close"])
    last = float(snap["close"])
    opened = _parse_date(pos.get("opened_at")) or today
    u = uni.get(sym) or {}
    surviving[sym] = {
        "symbol": sym,
        "run_id": run_id,
        "company_name": pos.get("company_name") or u.get("company_name"),
        "side": "LONG",
        "shares": int(pos.get("shares") or 0),
        "entry": entry,
        "last": round(last, 2),
        "stop": round(snap["lower"], 2) if snap.get("lower") is not None else pos.get("stop"),
        "n": None,
        "risk_usd": None,
        "sector": pos.get("sector") or u.get("sector") or "",
        "reason": pos.get("reason") or "",
        "rank": pos.get("rank"),
        "breakout": bool(snap.get("eligible")),
        "green": bool(snap.get("above_vwap")),
        "unrealized_pnl_usd": round((last - entry) * int(pos.get("shares") or 0), 2),
        "days_held": (today - opened).days,
        "opened_at": opened.isoformat(),
        "updated_at": now,
    }

