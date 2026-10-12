"""Build and refresh ``ema200_universe`` from Orbis universe + crypto shortlist."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from supabase import Client

from pipeline.ema200_scanner.config.loader import load_config
from pipeline.ema200_scanner.data.crypto import top_crypto_pairs
from pipeline.utils.supabase import fetch_all

logger = logging.getLogger(__name__)


def sync_ema200_universe(sb: Client) -> list[dict]:
    """Upsert US active equities from ``universe_members`` and configured crypto pairs."""
    cfg = load_config()
    now = datetime.now(timezone.utc).isoformat()
    rows: list[dict] = []

    members = fetch_all(
        sb,
        "universe_members",
        "symbol, exchange, country, is_active",
        filters=lambda q: q.eq("is_active", True),
    )
    for m in members:
        country = (m.get("country") or "").upper()
        if country != "US":
            continue
        sym = m.get("symbol")
        if not sym:
            continue
        rows.append(
            {
                "symbol": sym,
                "asset_class": "equity",
                "exchange": m.get("exchange"),
                "is_etf": False,
                "active": True,
                "updated_at": now,
            }
        )

    crypto_n = int(cfg.get("crypto", {}).get("top_n", 50))
    for pair in top_crypto_pairs(top_n=crypto_n):
        rows.append(
            {
                "symbol": pair.replace("/", "-"),
                "asset_class": "crypto",
                "exchange": "binance",
                "is_etf": False,
                "active": True,
                "updated_at": now,
            }
        )

    if not rows:
        logger.warning("ema200 universe sync produced zero rows")
        return []

    batch_size = 500
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        sb.table("ema200_universe").upsert(batch, on_conflict="symbol").execute()
    logger.info("Synced ema200_universe: %d symbols", len(rows))
    return rows
