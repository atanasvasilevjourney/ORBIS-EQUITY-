"""Restore LOOP paper_book rows from prior ENTER orders (ops / one-off).

Use when positions were removed in error (e.g. empty rebalance target flattening the book).
Requires SUPABASE_SERVICE_KEY (service role), not the anon/publishable key.

Usage:
    python -m pipeline.compute.restore_loop_book --tickers CRWD,PANW,A
    python -m pipeline.compute.restore_loop_book --tickers CRWD,PANW,A --dry-run
"""
from __future__ import annotations

import argparse
import logging
import os
from datetime import date, datetime, timedelta, timezone

from dotenv import load_dotenv
from supabase import create_client

from pipeline.compute.donchian_vwap import EQUITY, latest_snapshot
from pipeline.compute.loop_harness import loop_harness_config
from pipeline.utils.price_series import ohlcv_frame
from pipeline.utils.supabase import fetch_all

load_dotenv()
load_dotenv(".env.local")
logger = logging.getLogger(__name__)

DEFAULT_TICKERS = ("CRWD", "PANW", "A")
DEFAULT_ENTER_RUN = "run_2026-09-28_open_133215"
DEFAULT_DELETE_EXIT_RUN = "run_2026-10-13_040311"
PRICE_HISTORY_DAYS = 120


def _sb(*, write: bool):
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    if write and key.startswith("sb_publishable_"):
        raise RuntimeError(
            "SUPABASE_SERVICE_KEY looks like a publishable (anon) key; "
            "use the service_role secret for writes."
        )
    return create_client(url, key)


def _latest_enter_orders(sb, tickers: list[str]) -> dict[str, dict]:
    rows = fetch_all(
        sb,
        "paper_orders",
        "id,run_id,ticker,action,type,shares,limit_price,reason,sector,created_at",
        filters=lambda q: q.in_("ticker", tickers).eq("type", "ENTER").eq("action", "BUY"),
    )
    by_ticker: dict[str, dict] = {}
    for row in sorted(rows, key=lambda r: str(r.get("created_at") or "")):
        by_ticker[str(row["ticker"])] = row
    missing = [t for t in tickers if t not in by_ticker]
    if missing:
        raise RuntimeError(f"No ENTER orders found for: {missing}")
    return by_ticker


def build_book_rows(sb, tickers: list[str], run_id: str, now: str, today: date) -> list[dict]:
    enters = _latest_enter_orders(sb, tickers)
    uni = {
        r["symbol"]: r
        for r in fetch_all(
            sb,
            "universe_members",
            "symbol,company_name,sector",
            filters=lambda q: q.in_("symbol", tickers),
        )
    }
    cutoff = (today - timedelta(days=PRICE_HISTORY_DAYS)).isoformat()
    px = fetch_all(
        sb,
        "prices_daily",
        "symbol,date,open,high,low,close,adj_close,volume",
        filters=lambda q: q.in_("symbol", tickers).gte("date", cutoff),
    )
    rows: list[dict] = []
    for sym in tickers:
        ent = enters[sym]
        g = [r for r in px if r["symbol"] == sym]
        snap = latest_snapshot(ohlcv_frame(g)) if g else None
        entry = float(ent["limit_price"] or 0)
        if entry <= 0:
            raise RuntimeError(f"{sym}: invalid entry price on ENTER order")
        last = float(snap["close"]) if snap else entry
        opened = str(ent.get("created_at") or "")[:10] or today.isoformat()
        shares = int(ent["shares"] or 0)
        u = uni.get(sym) or {}
        strength = float(snap.get("strength") or 0) if snap else 0.0
        rows.append({
            "symbol": sym,
            "run_id": run_id,
            "company_name": u.get("company_name"),
            "side": "LONG",
            "shares": shares,
            "entry": round(entry, 2),
            "last": round(last, 2),
            "stop": round(snap["lower"], 2) if snap and snap.get("lower") is not None else None,
            "n": None,
            "risk_usd": None,
            "sector": ent.get("sector") or u.get("sector") or "",
            "reason": ent.get("reason") or "Restored from ENTER orders",
            "rank": min(100, int(round(strength * 1000))),
            "breakout": bool(snap.get("eligible")) if snap else False,
            "green": bool(snap.get("above_vwap")) if snap else False,
            "unrealized_pnl_usd": round((last - entry) * shares, 2),
            "days_held": max(0, (today - date.fromisoformat(opened)).days),
            "opened_at": opened,
            "updated_at": now,
        })
    return rows


def restore(
    tickers: list[str],
    *,
    delete_exit_run: str | None,
    dry_run: bool,
) -> None:
    sb = _sb(write=not dry_run)
    today = date.today()
    now = datetime.now(timezone.utc).isoformat()
    run_id = f"run_{today.isoformat()}_restore_{datetime.now(timezone.utc).strftime('%H%M%S')}"
    rows = build_book_rows(sb, tickers, run_id, now, today)
    deployed = sum((r["last"] or 0) * r["shares"] for r in rows)
    deployed_pct = deployed / EQUITY if EQUITY else 0.0

    for r in rows:
        logger.info(
            "%s %d sh entry %.2f last %.2f pnl %.2f opened %s",
            r["symbol"],
            r["shares"],
            r["entry"],
            r["last"],
            r["unrealized_pnl_usd"],
            r["opened_at"],
        )
    logger.info("deployed %.1f%% run_id=%s", deployed_pct * 100, run_id)

    if dry_run:
        logger.info("dry-run: no database writes")
        return

    if delete_exit_run:
        bad = fetch_all(
            sb,
            "paper_orders",
            "id",
            filters=lambda q: q.eq("run_id", delete_exit_run),
        )
        for o in bad:
            sb.table("paper_orders").delete().eq("id", o["id"]).execute()
        logger.info("deleted %d orders from %s", len(bad), delete_exit_run)

    run_row = {
        "run_id": run_id,
        "asof_date": today.isoformat(),
        "equity": EQUITY,
        "deployed_pct": round(deployed_pct, 4),
        "open_risk_pct": round(deployed_pct, 4),
        "names": len(rows),
        "posture": 70,
        "status": "OK",
        "headline": f"Restored · {len(rows)} names · deployed {deployed_pct * 100:.1f}%",
        "harness": {
            "lastRebalanceDate": "2026-09-28",
            "sectorExposure": [],
            "skipped": [],
            "restoredFrom": delete_exit_run,
            "config": loop_harness_config(),
        },
        "log": [{
            "at": now,
            "level": "INFO",
            "message": f"Manual restore: {', '.join(tickers)}",
        }],
        "computed_at": now,
    }
    # paper_book.run_id FK requires the run row first
    sb.table("paper_loop_runs").upsert(run_row, on_conflict="run_id").execute()
    sb.table("paper_book").upsert(rows, on_conflict="symbol").execute()
    logger.info("restore complete")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Restore LOOP paper book from ENTER history")
    parser.add_argument(
        "--tickers",
        default=",".join(DEFAULT_TICKERS),
        help="Comma-separated symbols (default: CRWD,PANW,A)",
    )
    parser.add_argument(
        "--delete-exit-run",
        default=DEFAULT_DELETE_EXIT_RUN,
        help="Remove EXIT orders from this run_id (default: erroneous 2026-10-13 rebalance)",
    )
    parser.add_argument("--no-delete-orders", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    restore(
        tickers,
        delete_exit_run=None if args.no_delete_orders else args.delete_exit_run,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
