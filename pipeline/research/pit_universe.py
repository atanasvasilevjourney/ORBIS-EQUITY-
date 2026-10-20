from __future__ import annotations

import logging
from datetime import date

from pipeline.ingest.us_index_universe import build_merged_universe
from pipeline.universe_filters import is_loop_tradable, is_pharma_stock

logger = logging.getLogger(__name__)


def symbols_from_snapshot_rows(rows: list[dict]) -> list[str]:
    return sorted(
        r["symbol"]
        for r in rows
        if r.get("is_active") and is_loop_tradable({**r, "is_active": True})
    )


def load_universe_symbols_as_of(sb, as_of: date) -> list[str]:
    """Latest stored snapshot on or before ``as_of``; falls back to live scrape with warning."""
    snap = (
        sb.table("universe_member_snapshots")
        .select("asof_date")
        .lte("asof_date", as_of.isoformat())
        .order("asof_date", desc=True)
        .limit(1)
        .execute()
    )
    rows = snap.data or []
    if not rows:
        logger.warning(
            "No universe_member_snapshots on or before %s — using live index (survivorship bias)",
            as_of,
        )
        stocks, _ = build_merged_universe()
        return sorted(
            s["symbol"]
            for s in stocks
            if is_loop_tradable({**s, "is_active": not is_pharma_stock(s)})
        )
    snap_date = rows[0]["asof_date"]
    members = (
        sb.table("universe_member_snapshots")
        .select("symbol, tier, sector, is_active")
        .eq("asof_date", snap_date)
        .eq("is_active", True)
        .execute()
    ).data or []
    return symbols_from_snapshot_rows(members)


def write_universe_snapshot(sb, asof: date, stocks: list[dict]) -> int:
    """Replace the day's snapshot rows."""
    payload = []
    for s in stocks:
        pharma = is_pharma_stock(s)
        payload.append(
            {
                "asof_date": asof.isoformat(),
                "symbol": s["symbol"],
                "tier": s.get("tier"),
                "sector": s.get("sector"),
                "industry": s.get("industry"),
                "is_active": not pharma,
            }
        )
    sb.table("universe_member_snapshots").delete().eq("asof_date", asof.isoformat()).execute()
    batch = 500
    for i in range(0, len(payload), batch):
        sb.table("universe_member_snapshots").upsert(
            payload[i : i + batch], on_conflict="asof_date,symbol"
        ).execute()
    return len(payload)
