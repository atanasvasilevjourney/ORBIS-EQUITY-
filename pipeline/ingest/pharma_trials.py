"""Pharma trials ingest: ClinicalTrials.gov → Supabase.

Fetches Phase 2/3 interventional drug trials for all mapped sponsors
in our universe, seeds the sponsor_ticker_map, and upserts trials
into pharma_trials.

Usage:
    python -m pipeline.ingest.pharma_trials
"""
import logging
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client, Client

from pipeline.config.settings import SupabaseConfig
from pipeline.clients.clinicaltrials import fetch_trials_for_sponsor
from pipeline.data.sponsor_map import SPONSOR_TICKER_MAP

load_dotenv()

logger = logging.getLogger(__name__)


def _get_supabase_client() -> Client:
    cfg = SupabaseConfig()
    if not cfg.url or not cfg.service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(cfg.url, cfg.service_key)


def _seed_sponsor_map(sb: Client) -> dict[str, str]:
    """Seed sponsor_ticker_map and return sponsor_name → ticker lookup."""
    logger.info("Seeding sponsor_ticker_map (%d entries)...", len(SPONSOR_TICKER_MAP))

    rows = []
    for entry in SPONSOR_TICKER_MAP:
        rows.append({
            "sponsor_name": entry["sponsor_name"],
            "ticker": entry["ticker"],
            "exchange": entry["exchange"],
            "aliases": entry.get("aliases", []),
            "verified": True,
        })

    try:
        sb.table("sponsor_ticker_map").upsert(
            rows, on_conflict="sponsor_name"
        ).execute()
    except Exception:
        logger.exception("Failed to seed sponsor_ticker_map")

    # Also load existing DB entries
    resp = sb.table("sponsor_ticker_map").select("sponsor_name, ticker, aliases").execute()
    lookup: dict[str, str] = {}
    for row in resp.data or []:
        lookup[row["sponsor_name"].lower()] = row["ticker"]
        for alias in row.get("aliases") or []:
            lookup[alias.lower()] = row["ticker"]

    return lookup


def _resolve_ticker(sponsor_name: str, lookup: dict[str, str]) -> str | None:
    """Resolve a ClinicalTrials.gov sponsor name to a ticker."""
    if not sponsor_name:
        return None
    key = sponsor_name.lower().strip()
    if key in lookup:
        return lookup[key]
    # Fuzzy: check if any known name is a substring
    for known, ticker in lookup.items():
        if known in key or key in known:
            return ticker
    return None


def main() -> None:
    """Fetch clinical trials for all mapped sponsors and upsert into Supabase."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== Pharma Trials Ingest Start ===")

    sb = _get_supabase_client()
    lookup = _seed_sponsor_map(sb)
    logger.info("Sponsor lookup has %d entries", len(lookup))

    # Get unique sponsors to query
    sponsors_to_query: list[dict] = []
    seen_tickers: set[str] = set()
    for entry in SPONSOR_TICKER_MAP:
        if entry["ticker"] not in seen_tickers:
            sponsors_to_query.append(entry)
            seen_tickers.add(entry["ticker"])

    total_trials = 0
    total_upserted = 0
    now = datetime.now(timezone.utc).isoformat()

    for entry in sponsors_to_query:
        sponsor = entry["sponsor_name"]
        ticker = entry["ticker"]
        logger.info("Fetching trials for %s (%s)...", sponsor, ticker)

        try:
            trials = fetch_trials_for_sponsor(sponsor, max_results=100)
        except Exception:
            logger.exception("Failed to fetch trials for %s", sponsor)
            continue

        logger.info("  %s: %d trials found", ticker, len(trials))
        total_trials += len(trials)

        if not trials:
            continue

        rows = []
        for trial in trials:
            resolved_ticker = _resolve_ticker(trial["lead_sponsor"], lookup) or ticker
            rows.append({
                "nct_id": trial["nct_id"],
                "ticker": resolved_ticker,
                "drug_name": trial["drug_name"],
                "condition": trial["condition"],
                "phase": trial["phase"],
                "overall_status": trial["overall_status"],
                "lead_sponsor": trial["lead_sponsor"],
                "start_date": trial["start_date"],
                "completion_date": trial["completion_date"],
                "results_posted": trial["results_posted"],
                "updated_at": now,
            })

        try:
            sb.table("pharma_trials").upsert(
                rows, on_conflict="nct_id"
            ).execute()
            total_upserted += len(rows)
            logger.info("  %s: %d trials upserted", ticker, len(rows))
        except Exception:
            logger.exception("Failed to upsert trials for %s", ticker)

    logger.info(
        "=== Pharma Trials Ingest Complete: %d found, %d upserted ===",
        total_trials, total_upserted,
    )


if __name__ == "__main__":
    main()
