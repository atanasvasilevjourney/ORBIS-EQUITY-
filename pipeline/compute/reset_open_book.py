"""Reset the LOOP paper book to $100,000 and fill at the session open.

Signals stay on the prior close (Donchian 55 + VWAP). Shares are a fresh
equal-weight book. Fills use today's opening print, not the prior close.

Usage:
    python -m pipeline.compute.reset_open_book --flatten
    python -m pipeline.compute.reset_open_book --fill
"""
from __future__ import annotations

import argparse
import os
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import pandas as pd
import yfinance as yf
from dotenv import load_dotenv
from supabase import create_client

from pipeline.compute.donchian_vwap import (
    EQUITY,
    MAX_PER_SECTOR,
    MIN_NOTIONAL,
    MIN_PRICE,
    TOP_N,
    prior_bar_snapshot,
)
from pipeline.universe_filters import is_loop_tradable
from pipeline.utils.supabase import fetch_all

load_dotenv()
load_dotenv(".env.local")

def _session_day() -> date:
    """New York cash-session date. The open belongs to that calendar day."""
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York")).date()


def _sb():
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(url, key)


def _targets(sb) -> list[dict]:
    universe = fetch_all(
        sb,
        "universe_members",
        "symbol, company_name, sector, industry, tier, is_active",
        filters=lambda q: q.eq("is_active", True),
    )
    uni = {r["symbol"]: r for r in universe if is_loop_tradable(r)}
    cutoff = (_session_day() - timedelta(days=120)).isoformat()
    rows = fetch_all(
        sb,
        "prices_daily",
        "symbol,date,open,high,low,close,volume",
        filters=lambda q: q.gte("date", cutoff),
    )
    df = pd.DataFrame(rows)
    cands: list[tuple[str, float, dict, float]] = []
    for sym, g in df.groupby("symbol"):
        if sym not in uni:
            continue
        prev = prior_bar_snapshot(g.sort_values("date"))
        if prev and prev.get("eligible") and prev.get("close"):
            cands.append((sym, float(prev["strength"]), uni[sym], float(prev["lower"]) if prev.get("lower") else None))
    cands.sort(key=lambda x: -x[1])
    sector_count: dict[str, int] = defaultdict(int)
    picked: list[dict] = []
    for sym, strength, u, lower in cands:
        sec = u.get("sector") or "Unknown"
        if sector_count[sec] >= MAX_PER_SECTOR:
            continue
        picked.append({"symbol": sym, "strength": strength, "meta": u, "lower": lower})
        sector_count[sec] += 1
        if len(picked) >= TOP_N:
            break
    return picked


def _posture(sb) -> int:
    rows = fetch_all(sb, "daily_brief", "asof_date, inputs")
    if not rows:
        return 50
    latest = sorted(rows, key=lambda x: str(x.get("asof_date") or ""), reverse=True)[0]
    inputs = latest.get("inputs") or {}
    if isinstance(inputs, dict):
        return int(inputs.get("posture_score") or 50)
    return 50


def flatten() -> None:
    sb = _sb()
    book = fetch_all(sb, "paper_book", "symbol,shares,last,sector,company_name")
    session = _session_day()
    now = datetime.now(timezone.utc)
    run_id = f"run_{session.isoformat()}_reset_{now.strftime('%H%M%S')}"
    orders = []
    for i, pos in enumerate(book, start=1):
        orders.append({
            "id": f"{run_id}_ord_{i:03d}",
            "run_id": run_id,
            "ticker": pos["symbol"],
            "action": "SELL",
            "type": "EXIT",
            "shares": int(pos.get("shares") or 0),
            "limit_price": pos.get("last"),
            "reason": "Reset · flat book, new entries at the session open",
            "sector": pos.get("sector") or "",
            "risk_usd": None,
        })
    sb.table("paper_loop_runs").upsert({
        "run_id": run_id,
        "asof_date": session.isoformat(),
        "equity": EQUITY,
        "deployed_pct": 0,
        "open_risk_pct": 0,
        "names": 0,
        "posture": _posture(sb),
        "status": "OK",
        "headline": f"Reset to ${EQUITY:,.0f} · {len(book)} closed · waiting for {session.isoformat()} open",
        "harness": {
            "lastRebalanceDate": session.isoformat(),
            "config": {
                "engine": "donchian_vwap",
                "entryChannel": 55,
                "exitChannel": 20,
                "vwapWindow": 20,
                "maxNames": TOP_N,
                "maxPerSector": MAX_PER_SECTOR,
                "rebalanceDays": 5,
                "equalWeight": True,
                "fill": "session_open",
            },
            "sectorExposure": [],
            "skipped": [],
        },
        "log": [{
            "at": now.isoformat(),
            "level": "INFO",
            "message": "Equity reset to 100000. Old book closed. New book fills at today's open.",
        }],
        "computed_at": now.isoformat(),
    }, on_conflict="run_id").execute()
    for pos in book:
        sb.table("paper_book").delete().eq("symbol", pos["symbol"]).execute()
    if orders:
        sb.table("paper_orders").upsert(orders, on_conflict="id").execute()
    print(f"FLAT {run_id} closed {len(book)}")


def session_opens(symbols: list[str]) -> dict[str, float] | None:
    """Opening prints for the New York session. None until that bar exists."""
    session = _session_day()
    raw = yf.download(
        symbols + ["SPY"],
        start=session.isoformat(),
        end=(session + timedelta(days=1)).isoformat(),
        interval="1d",
        auto_adjust=True,
        progress=False,
        group_by="ticker",
        threads=False,
    )
    if raw is None or getattr(raw, "empty", True) or not isinstance(raw.columns, pd.MultiIndex):
        return None

    def _open(sym: str) -> float | None:
        if sym not in raw.columns.get_level_values(0):
            return None
        frame = raw[sym]
        col = "Open" if "Open" in frame.columns else "open"
        if col not in frame.columns:
            return None
        val = frame[col].dropna()
        if val.empty:
            return None
        px = float(val.iloc[-1])
        return px if px > 0 else None

    if _open("SPY") is None:
        return None
    opens = {sym: px for sym in symbols if (px := _open(sym)) is not None}
    if len(opens) != len(symbols):
        return None
    return opens


def fill() -> bool:
    sb = _sb()
    targets = _targets(sb)
    if not targets:
        print("NO TARGETS")
        return False
    opens = session_opens([t["symbol"] for t in targets])
    if not opens:
        print("NO OPEN YET")
        return False
    session = _session_day()
    now = datetime.now(timezone.utc)
    run_id = f"run_{session.isoformat()}_open_{now.strftime('%H%M%S')}"
    slot = EQUITY / len(targets)
    rows = []
    orders = []
    for i, t in enumerate(targets, start=1):
        sym = t["symbol"]
        px = opens[sym]
        if px < MIN_PRICE:
            continue
        shares = int(slot // px)
        if shares < 1 or shares * px < MIN_NOTIONAL:
            continue
        u = t["meta"]
        strength = t["strength"]
        reason = f"DC55+VWAP20 · session open {px:.2f} · str {strength:.3f}"
        rows.append({
            "symbol": sym,
            "run_id": run_id,
            "company_name": u.get("company_name"),
            "side": "LONG",
            "shares": shares,
            "entry": round(px, 2),
            "last": round(px, 2),
            "stop": round(t["lower"], 2) if t["lower"] else None,
            "n": None,
            "risk_usd": None,
            "sector": u.get("sector") or "",
            "reason": reason,
            "rank": min(100, int(round(strength * 1000))),
            "breakout": True,
            "green": True,
            "unrealized_pnl_usd": 0.0,
            "days_held": 0,
            "opened_at": session.isoformat(),
            "updated_at": now.isoformat(),
        })
        orders.append({
            "id": f"{run_id}_ord_{i:03d}",
            "run_id": run_id,
            "ticker": sym,
            "action": "BUY",
            "type": "ENTER",
            "shares": shares,
            "limit_price": round(px, 2),
            "reason": reason,
            "sector": u.get("sector") or "",
            "risk_usd": None,
        })
    deployed = sum(r["entry"] * r["shares"] for r in rows)
    deployed_pct = deployed / EQUITY
    sb.table("paper_loop_runs").upsert({
        "run_id": run_id,
        "asof_date": session.isoformat(),
        "equity": EQUITY,
        "deployed_pct": round(deployed_pct, 4),
        "open_risk_pct": round(deployed_pct, 4),
        "names": len(rows),
        "posture": _posture(sb),
        "status": "OK",
        "headline": f"Reset ${EQUITY:,.0f} · {len(rows)} enter at {session.isoformat()} open · deployed {deployed_pct*100:.1f}%",
        "harness": {
            "lastRebalanceDate": session.isoformat(),
            "config": {
                "engine": "donchian_vwap",
                "entryChannel": 55,
                "exitChannel": 20,
                "vwapWindow": 20,
                "maxNames": TOP_N,
                "maxPerSector": MAX_PER_SECTOR,
                "rebalanceDays": 5,
                "equalWeight": True,
                "fill": "session_open",
            },
            "sectorExposure": [],
            "skipped": [],
        },
        "log": [{
            "at": now.isoformat(),
            "level": "INFO",
            "message": "Fresh $100,000 book filled at the session open.",
        }],
        "computed_at": now.isoformat(),
    }, on_conflict="run_id").execute()
    # drop anything left from the old book
    existing = fetch_all(sb, "paper_book", "symbol")
    keep = {r["symbol"] for r in rows}
    for pos in existing:
        if pos["symbol"] not in keep:
            sb.table("paper_book").delete().eq("symbol", pos["symbol"]).execute()
    if rows:
        sb.table("paper_book").upsert(rows, on_conflict="symbol").execute()
    if orders:
        sb.table("paper_orders").upsert(orders, on_conflict="id").execute()
    print(f"FILLED {run_id}")
    for r in rows:
        print(f"  {r['symbol']} {r['shares']} @ {r['entry']}")
    print(f"DEPLOYED {deployed:.2f} ({deployed_pct*100:.1f}%)")
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--flatten", action="store_true")
    parser.add_argument("--fill", action="store_true")
    args = parser.parse_args()
    if args.flatten:
        flatten()
    if args.fill:
        raise SystemExit(0 if fill() else 2)


if __name__ == "__main__":
    main()
