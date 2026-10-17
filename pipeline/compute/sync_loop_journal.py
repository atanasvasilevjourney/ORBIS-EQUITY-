"""Persist closed LOOP trades into trading_journal from paper_orders."""
from __future__ import annotations

import hashlib
import logging

from supabase import Client

from pipeline.research.loop_log_report import closed_trades
from pipeline.utils.supabase import fetch_all

logger = logging.getLogger(__name__)

DESK = "loop"


def _journal_id(row: dict) -> str:
    key = (
        f"{row.get('exit_order_id')}|{row['ticker']}|{row.get('entered_at')}|"
        f"{row['shares']}|{row['entry']}"
    )
    digest = hashlib.sha256(key.encode()).hexdigest()[:24]
    return f"loop-{digest}"


def closed_trades_to_journal_rows(closed_df) -> list[dict]:
    if closed_df is None or len(closed_df) == 0:
        return []
    rows: list[dict] = []
    for rec in closed_df.to_dict(orient="records"):
        row = {
            "id": _journal_id(rec),
            "desk": DESK,
            "symbol": rec["ticker"],
            "side": "LONG",
            "shares": int(rec["shares"]),
            "entry_price": float(rec["entry"]),
            "exit_price": float(rec["exit"]),
            "pnl_usd": round(float(rec["pnl_usd"]), 2),
            "return_pct": round(float(rec["return_pct"]), 4) if rec.get("return_pct") is not None else None,
            "sector": rec.get("sector"),
            "entry_reason": rec.get("entry_reason"),
            "exit_reason": rec.get("exit_reason"),
            "entered_at": rec.get("entered_at"),
            "exited_at": rec.get("exited_at"),
            "exit_order_id": rec.get("exit_order_id"),
        }
        rows.append(row)
    return rows


def sync_loop_trading_journal(sb: Client) -> int:
    """Rebuild LOOP journal rows from full paper_orders history. Returns row count upserted."""
    orders = fetch_all(
        sb,
        "paper_orders",
        "id, run_id, ticker, action, type, shares, limit_price, reason, sector, risk_usd, created_at",
        order=("created_at", False),
    )
    closed = closed_trades(orders)
    rows = closed_trades_to_journal_rows(closed)
    if not rows:
        return 0
    sb.table("trading_journal").upsert(rows, on_conflict="id").execute()
    logger.info("trading_journal: upserted %s LOOP closed trade(s)", len(rows))
    return len(rows)


def main() -> None:
    import os

    from dotenv import load_dotenv
    from supabase import create_client

    load_dotenv()
    load_dotenv(".env.local")
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY")
    sb = create_client(url, key)
    n = sync_loop_trading_journal(sb)
    print(f"Upserted {n} trading_journal row(s) for desk={DESK}")


if __name__ == "__main__":
    main()
