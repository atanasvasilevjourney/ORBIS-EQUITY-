"""Equity breakout portfolio harness — LOOP TERMINAL engine.

Turns Trend Radar (screener) into a tradable paper book:

  Entry   GREEN + rank>=60 + z_mom>0 + f_ewmac>0 + (breakout OR vol-confirm)
  Size    Turtle-style: shares = floor((equity * 1%) / (2N)), N = 14d ATR
  Stop    2N below fill (prior close used as fill for paper EOD)
  Caps    max 8 names, max 2 per sector, 8% open heat, 15% name notional
  Skip    earnings in next 5 days, insufficient ATR, posture < 50 (no new entries)
  Exit    stop (low <= stop), state RED, rank < 50, dual-momentum fail

Does NOT place live broker orders. Writes paper_loop_runs / paper_book / paper_orders.

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

from pipeline.utils.supabase import fetch_all

load_dotenv()
load_dotenv(".env.local")
logger = logging.getLogger(__name__)

EQUITY = 100_000.0
RISK_PCT = 0.01
STOP_N = 2.0
MAX_NAMES = 8
MAX_PER_SECTOR = 2
MAX_NAME_PCT = 0.15
MAX_OPEN_RISK_PCT = 0.08
MIN_RANK = 60
ATR_WINDOW = 14
EARNINGS_BLACKOUT_DAYS = 5
POSTURE_ENTRY_MIN = 50
MIN_ATR = 0.25
MIN_PRICE = 10.0
MIN_NOTIONAL = 500.0


def _sb():
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(url, key)


def _atr14(df: pd.DataFrame) -> float | None:
    if len(df) < ATR_WINDOW + 1:
        return None
    d = df.sort_values("date").reset_index(drop=True)
    high = d["high"].astype(float)
    low = d["low"].astype(float)
    close = d["close"].astype(float)
    tr = pd.concat(
        [high - low, (high - close.shift(1)).abs(), (low - close.shift(1)).abs()],
        axis=1,
    ).max(axis=1)
    val = float(tr.iloc[-ATR_WINDOW:].mean())
    if val <= 0 or pd.isna(val):
        return None
    return val


def _parse_date(v) -> date | None:
    if not v:
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== Portfolio Loop Start (equity breakout harness) ===")
    sb = _sb()
    today = date.today()
    run_id = f"run_{today.isoformat()}_{datetime.now(timezone.utc).strftime('%H%M%S')}"
    now = datetime.now(timezone.utc).isoformat()
    log: list[dict] = []

    def note(level: str, message: str) -> None:
        log.append({"at": now, "level": level, "message": message})
        logger.info("%s %s", level, message)

    universe = fetch_all(sb, "universe_members", "symbol, company_name, sector", filters=lambda q: q.eq("is_active", True))
    radar = fetch_all(
        sb,
        "trend_radar",
        "symbol, state, quality_rank, z_mom, f_ewmac, z_52, breakout_active, volume_confirmed, convergence_count",
    )
    funds = fetch_all(sb, "fundamentals_snapshot", "symbol, price")
    earnings = fetch_all(sb, "earnings_calendar", "ticker, event_date")
    brief_rows = fetch_all(sb, "daily_brief", "asof_date, inputs")
    book_rows = fetch_all(sb, "paper_book", "*")

    uni = {r["symbol"]: r for r in universe}
    fund_map = {r["symbol"]: r for r in funds}
    radar_map = {r["symbol"]: r for r in radar}

    posture = 50
    if brief_rows:
        latest = sorted(brief_rows, key=lambda x: str(x.get("asof_date") or ""), reverse=True)[0]
        inputs = latest.get("inputs") or {}
        if isinstance(inputs, dict):
            posture = int(inputs.get("posture_score") or 50)

    # Earnings blackout set
    blackout: set[str] = set()
    horizon = today + timedelta(days=EARNINGS_BLACKOUT_DAYS)
    for e in earnings:
        ev = _parse_date(e.get("event_date"))
        if ev and today <= ev <= horizon:
            blackout.add(e.get("ticker") or "")

    # Prices for ATR + last close
    cutoff = (today - timedelta(days=60)).isoformat()
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
    px_df = pd.DataFrame(all_px) if all_px else pd.DataFrame(columns=["symbol", "date", "open", "high", "low", "close", "volume"])

    atr_map: dict[str, float] = {}
    last_map: dict[str, float] = {}
    low_map: dict[str, float] = {}
    if not px_df.empty:
        for sym, g in px_df.groupby("symbol"):
            n = _atr14(g)
            if n:
                atr_map[sym] = n
            g2 = g.sort_values("date")
            last_map[sym] = float(g2.iloc[-1]["close"])
            low_map[sym] = float(g2.iloc[-1]["low"])

    note("INFO", f"Loop start · equity ${EQUITY:,.0f} · {len(book_rows)} open · posture {posture}")

    skipped: list[dict] = []

    def skip(ticker: str, reason: str, detail: str, sector: str = "", rank=None) -> None:
        skipped.append({"ticker": ticker, "sector": sector, "rank": rank, "reason": reason, "detail": detail})
        note("SKIP", f"{ticker} · {reason} · {detail}")

    # --- 1. Exits from existing book ---------------------------------------
    orders: list[dict] = []
    surviving: list[dict] = []
    oid = 0

    def add_order(**kw) -> None:
        nonlocal oid
        oid += 1
        orders.append({"id": f"{run_id}_ord_{oid:03d}", "run_id": run_id, **kw})

    for pos in book_rows:
        sym = pos["symbol"]
        r = radar_map.get(sym) or {}
        last = last_map.get(sym) or float(pos.get("last") or pos.get("entry") or 0)
        stop = float(pos.get("stop") or 0)
        shares = int(pos.get("shares") or 0)
        sector = pos.get("sector") or (uni.get(sym) or {}).get("sector") or ""
        opened = _parse_date(pos.get("opened_at")) or today
        days_held = (today - opened).days
        exit_reason = None
        if stop and low_map.get(sym, last) <= stop:
            exit_reason = f"Stop hit · last {last:.2f} ≤ stop {stop:.2f}"
        elif r.get("state") == -1:
            exit_reason = "State RED"
        elif (r.get("quality_rank") or 0) < 50:
            exit_reason = f"Rank decay {r.get('quality_rank')}"
        elif (r.get("z_mom") or 0) < 0 and (r.get("f_ewmac") or 0) < 0:
            exit_reason = "Momentum failure (z_mom & EWMAC < 0)"

        if exit_reason:
            add_order(
                ticker=sym, action="SELL", type="EXIT", shares=shares,
                limit_price=None, reason=exit_reason, sector=sector, risk_usd=None,
            )
            note("ORDER", f"EXIT {sym} {shares} · {exit_reason}")
            continue

        n = float(pos.get("n") or atr_map.get(sym) or 0)
        entry = float(pos.get("entry") or last)
        risk = max(0.0, (last - stop) * shares) if stop else float(pos.get("risk_usd") or 0)
        surviving.append({
            "symbol": sym,
            "run_id": run_id,
            "company_name": pos.get("company_name") or (uni.get(sym) or {}).get("company_name"),
            "side": "LONG",
            "shares": shares,
            "entry": entry,
            "last": last,
            "stop": stop,
            "n": n,
            "risk_usd": round(risk, 2),
            "sector": sector,
            "reason": pos.get("reason") or "",
            "rank": r.get("quality_rank") or pos.get("rank"),
            "breakout": bool(r.get("breakout_active")),
            "green": r.get("state") == 1,
            "unrealized_pnl_usd": round((last - entry) * shares, 2),
            "days_held": days_held,
            "opened_at": opened.isoformat(),
            "updated_at": now,
        })

    # --- 2. New entries ----------------------------------------------------
    allow_new = posture >= POSTURE_ENTRY_MIN
    if not allow_new:
        note("WARN", f"Posture {posture} < {POSTURE_ENTRY_MIN} — no new entries")

    candidates = []
    if allow_new:
        for r in radar:
            sym = r["symbol"]
            u = uni.get(sym)
            if not u:
                continue
            sector = u.get("sector") or "Unknown"
            rank = int(r.get("quality_rank") or 0)
            last = last_map.get(sym) or (fund_map.get(sym) or {}).get("price")
            n = atr_map.get(sym)

            if r.get("state") != 1:
                continue  # not a skip of a "candidate" — just not in universe
            if rank < MIN_RANK:
                skip(sym, "BELOW_MIN_RANK", f"rank {rank} < {MIN_RANK}", sector, rank)
                continue
            if not (r.get("z_mom") or 0) > 0 or not (r.get("f_ewmac") or 0) > 0:
                skip(sym, "NOT_BREAKOUT", "z_mom or EWMAC not positive", sector, rank)
                continue
            if not (r.get("breakout_active") or r.get("volume_confirmed")):
                # Turtle System 2: high-rank GREEN trend without same-day BRK flag
                z52_raw = r.get("z_52")
                z52 = float(z52_raw) if z52_raw is not None else -1.0
                if not (rank >= 65 and z52 > -0.10):
                    skip(sym, "NOT_BREAKOUT", "no BRK/vol confirm and rank<65 System-2", sector, rank)
                    continue
            if last is None or float(last) < MIN_PRICE:
                skip(sym, "INSUFFICIENT_ATR", f"price {last}", sector, rank)
                continue
            if n is None or n < MIN_ATR:
                skip(sym, "INSUFFICIENT_ATR", f"ATR {n}", sector, rank)
                continue
            if sym in blackout:
                skip(sym, "EARNINGS_WINDOW", f"earnings within {EARNINGS_BLACKOUT_DAYS}d", sector, rank)
                continue
            if any(p["symbol"] == sym for p in surviving):
                skip(sym, "DUPLICATE_SIGNAL", "already in book", sector, rank)
                continue
            candidates.append({
                "symbol": sym, "sector": sector, "rank": rank,
                "last": float(last), "n": float(n),
                "company": u.get("company_name") or "",
                "breakout": bool(r.get("breakout_active")),
                "vol": bool(r.get("volume_confirmed")),
                "conv": int(r.get("convergence_count") or 0),
                "z52": float(r.get("z_52") or 0),
            })

        candidates.sort(key=lambda c: (c["rank"], c["conv"], c["vol"], c["z52"]), reverse=True)

    sector_count: dict[str, int] = defaultdict(int)
    for p in surviving:
        sector_count[p["sector"] or "Unknown"] += 1

    open_risk = sum(p["risk_usd"] or 0 for p in surviving)

    for c in candidates:
        if len(surviving) >= MAX_NAMES:
            skip(c["symbol"], "ALREADY_AT_MAX_NAMES", f"book full {MAX_NAMES}", c["sector"], c["rank"])
            continue
        if sector_count[c["sector"]] >= MAX_PER_SECTOR:
            skip(c["symbol"], "SECTOR_CAP", f"{c['sector']} already {MAX_PER_SECTOR}", c["sector"], c["rank"])
            continue
        stop_dist = STOP_N * c["n"]
        if stop_dist <= 0:
            skip(c["symbol"], "INSUFFICIENT_ATR", "stop distance 0", c["sector"], c["rank"])
            continue
        risk_budget = EQUITY * RISK_PCT
        shares = int(risk_budget // stop_dist)
        notional = shares * c["last"]
        if notional > EQUITY * MAX_NAME_PCT:
            shares = int((EQUITY * MAX_NAME_PCT) // c["last"])
            notional = shares * c["last"]
        if shares < 1 or notional < MIN_NOTIONAL:
            skip(c["symbol"], "INSUFFICIENT_EQUITY", f"shares {shares} notional {notional:.0f}", c["sector"], c["rank"])
            continue
        risk_usd = round(stop_dist * shares, 2)
        if (open_risk + risk_usd) / EQUITY > MAX_OPEN_RISK_PCT:
            skip(c["symbol"], "INSUFFICIENT_EQUITY", f"open heat would exceed {MAX_OPEN_RISK_PCT:.0%}", c["sector"], c["rank"])
            continue

        stop = round(c["last"] - stop_dist, 2)
        tags = []
        if c["breakout"]:
            tags.append("BRK")
        elif c["vol"]:
            tags.append("VOL")
        else:
            tags.append("TREND")
        tags.append("GREEN")
        reason = f"{'+'.join(tags)} rank {c['rank']}"
        surviving.append({
            "symbol": c["symbol"],
            "run_id": run_id,
            "company_name": c["company"],
            "side": "LONG",
            "shares": shares,
            "entry": round(c["last"], 2),
            "last": round(c["last"], 2),
            "stop": stop,
            "n": round(c["n"], 4),
            "risk_usd": risk_usd,
            "sector": c["sector"],
            "reason": reason,
            "rank": c["rank"],
            "breakout": c["breakout"],
            "green": True,
            "unrealized_pnl_usd": 0.0,
            "days_held": 0,
            "opened_at": today.isoformat(),
            "updated_at": now,
        })
        open_risk += risk_usd
        sector_count[c["sector"]] += 1
        add_order(
            ticker=c["symbol"], action="BUY", type="ENTER", shares=shares,
            limit_price=round(c["last"], 2), reason=reason, sector=c["sector"], risk_usd=risk_usd,
        )
        note("ORDER", f"ENTER {c['symbol']} {shares} · {reason} · N={c['n']:.2f} stop {stop}")

    deployed = sum((p["last"] or 0) * p["shares"] for p in surviving)
    deployed_pct = deployed / EQUITY if EQUITY else 0
    open_risk_pct = open_risk / EQUITY if EQUITY else 0

    sector_exposure = []
    for sector, cnt in sorted(sector_count.items()):
        mv = sum((p["last"] or 0) * p["shares"] for p in surviving if (p["sector"] or "Unknown") == sector)
        exp = mv / EQUITY if EQUITY else 0
        cap = MAX_PER_SECTOR / MAX_NAMES  # 2/8 = 25% name-count cap analogue
        sector_exposure.append({
            "sector": sector,
            "exposurePct": round(exp, 4),
            "capPct": round(cap, 4),
            "utilizationPct": round(cnt / MAX_PER_SECTOR, 4) if MAX_PER_SECTOR else 0,
            "names": cnt,
        })

    harness = {
        "sectorExposure": sector_exposure,
        "skipped": skipped[:40],
        "config": {
            "riskPerTradePct": RISK_PCT,
            "maxOpenRiskPct": MAX_OPEN_RISK_PCT,
            "maxSectorPct": MAX_PER_SECTOR / MAX_NAMES,
            "maxNames": MAX_NAMES,
            "minRank": MIN_RANK,
            "atrWindow": ATR_WINDOW,
            "stopMultipleN": STOP_N,
            "earningsBlackoutDays": EARNINGS_BLACKOUT_DAYS,
            "minAtrUsd": MIN_ATR,
        },
    }

    n_enter = sum(1 for o in orders if o["type"] == "ENTER")
    n_exit = sum(1 for o in orders if o["type"] == "EXIT")
    headline = f"{n_exit} exit · {n_enter} enter · {len(skipped)} skipped · open risk {open_risk_pct*100:.1f}%"

    # Persist: insert run first (FK), replace book + this-run orders
    sb.table("paper_loop_runs").upsert({
        "run_id": run_id,
        "asof_date": today.isoformat(),
        "equity": EQUITY,
        "deployed_pct": round(deployed_pct, 4),
        "open_risk_pct": round(open_risk_pct, 4),
        "names": len(surviving),
        "posture": posture,
        "status": "OK",
        "headline": headline,
        "harness": harness,
        "log": log[-40:],
        "computed_at": now,
    }, on_conflict="run_id").execute()

    existing_syms = {p["symbol"] for p in book_rows}
    new_syms = {p["symbol"] for p in surviving}
    dropped = existing_syms - new_syms
    for sym in dropped:
        try:
            sb.table("paper_book").delete().eq("symbol", sym).execute()
        except Exception:
            logger.exception("Failed to delete %s from paper_book", sym)

    if surviving:
        sb.table("paper_book").upsert(surviving, on_conflict="symbol").execute()

    if orders:
        sb.table("paper_orders").upsert(orders, on_conflict="id").execute()

    note("INFO", f"Loop complete · {headline}")
    logger.info("=== Portfolio Loop Complete: %s ===", headline)


if __name__ == "__main__":
    main()
