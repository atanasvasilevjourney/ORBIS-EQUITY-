"""Earnings calendar ingest: LSE z_company_calendar → Supabase.

Fetches earnings events for all universe members from the LSE API
and upserts into the earnings_calendar table, computing surprise
percentages where actual and estimated EPS are available.

Usage:
    python -m pipeline.ingest.earnings
"""
import logging
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client, Client

from pipeline.config.settings import SupabaseConfig
from pipeline.clients.lse_api import LSEClient

load_dotenv()

logger = logging.getLogger(__name__)


def _get_supabase_client() -> Client:
    cfg = SupabaseConfig()
    if not cfg.url or not cfg.service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(cfg.url, cfg.service_key)


def main() -> None:
    """Fetch earnings from LSE and upsert into earnings_calendar."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== Earnings Ingest Start ===")

    lse = LSEClient()
    sb = _get_supabase_client()

    # Fetch all universe symbols
    resp = sb.table("universe_members").select("symbol").eq("is_active", True).execute()
    symbols = [r["symbol"] for r in (resp.data or [])]
    logger.info("Universe has %d active symbols", len(symbols))

    # Fetch earnings in bulk from LSE (no per-symbol filter = all)
    logger.info("Fetching earnings events from LSE API...")
    try:
        raw_earnings = lse.get_earnings(limit=5000)
    except Exception:
        logger.exception("Failed to fetch earnings from LSE")
        return

    logger.info("Received %d raw earnings events", len(raw_earnings))

    # Filter to universe symbols
    universe_set = set(symbols)
    rows: list[dict] = []

    for e in raw_earnings:
        symbol = e.get("symbol")
        if not symbol or symbol not in universe_set:
            continue

        event_date = e.get("event_date")
        if not event_date:
            continue

        eps_est = e.get("eps_estimated")
        eps_actual = e.get("eps_actual")
        rev_est = e.get("revenue_estimated")
        rev_actual = e.get("revenue_actual")

        # Compute surprise percentage
        surprise_pct = None
        if eps_est is not None and eps_actual is not None and eps_est != 0:
            surprise_pct = round(((eps_actual - eps_est) / abs(eps_est)) * 100, 2)

        rows.append({
            "ticker": symbol,
            "event_date": event_date,
            "confirmed": eps_actual is not None,
            "source": "lse",
            "eps_est": eps_est,
            "eps_actual": eps_actual,
            "surprise_pct": surprise_pct,
            "revenue_est": int(rev_est) if rev_est else None,
            "revenue_actual": int(rev_actual) if rev_actual else None,
        })

    logger.info("Mapped %d earnings events for universe symbols", len(rows))

    if not rows:
        logger.info("No earnings to upsert.")
        return

    # Batch upsert
    batch_size = 500
    upserted = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            sb.table("earnings_calendar").upsert(
                batch, on_conflict="ticker,event_date"
            ).execute()
            upserted += len(batch)
            logger.info("Earnings upserted %d/%d", upserted, len(rows))
        except Exception:
            logger.exception("Failed to upsert earnings batch %d-%d", i, i + len(batch))

    # Stats
    reported = sum(1 for r in rows if r["confirmed"])
    beats = sum(1 for r in rows if r["surprise_pct"] is not None and r["surprise_pct"] > 0)
    misses = sum(1 for r in rows if r["surprise_pct"] is not None and r["surprise_pct"] < 0)

    logger.info(
        "=== Earnings Ingest Complete: %d upserted | %d reported | %d beats | %d misses ===",
        upserted, reported, beats, misses,
    )


if __name__ == "__main__":
    main()
