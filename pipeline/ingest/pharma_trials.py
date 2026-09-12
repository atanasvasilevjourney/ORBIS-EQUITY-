"""Health-sector catalyst ingest: ClinicalTrials.gov -> pharma_trials.

For every active Health Care universe member, pulls that company's recent
interventional clinical trials (lead-sponsor search) from the free
ClinicalTrials.gov Data API v2 and upserts them into `pharma_trials`,
tagged with the ticker. These trial readouts are the raw catalysts the
`pharma_signals` compute step turns into tradable signals.

Usage:
    python -m pipeline.ingest.pharma_trials
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client, Client

from pipeline.clients.clinicaltrials import fetch_trials_for_sponsor
from pipeline.config.settings import SupabaseConfig
from pipeline.utils.supabase import fetch_all

load_dotenv()
load_dotenv(".env.local")

logger = logging.getLogger(__name__)

HEALTH_SECTORS = {"Health Care", "Healthcare", "Health"}
TRIALS_PER_SPONSOR = 25

# Registered ClinicalTrials.gov lead-sponsor names differ from company names
# (e.g. J&J files under "Janssen"). Fall back to company_name when unmapped.
SPONSOR_MAP: dict[str, str] = {
    "MRNA": "ModernaTX",
    "PFE": "Pfizer",
    "MRK": "Merck Sharp",
    "JNJ": "Janssen",
    "AZN": "AstraZeneca",
    "NVS": "Novartis",
    "LLY": "Eli Lilly",
    "ABBV": "AbbVie",
    "BMY": "Bristol-Myers Squibb",
    "GILD": "Gilead Sciences",
    "AMGN": "Amgen",
    "BNTX": "BioNTech",
}


def _get_supabase_client() -> Client:
    cfg = SupabaseConfig()
    if not cfg.url or not cfg.service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(cfg.url, cfg.service_key)


def _health_members(sb: Client) -> list[dict]:
    rows = fetch_all(
        sb,
        "universe_members",
        "symbol, company_name, sector",
        filters=lambda q: q.eq("is_active", True),
    )
    return [r for r in rows if (r.get("sector") or "") in HEALTH_SECTORS]


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== Pharma Trials Ingest Start (ClinicalTrials.gov) ===")

    sb = _get_supabase_client()
    members = _health_members(sb)
    logger.info("Found %d Health Care universe members", len(members))

    now = datetime.now(timezone.utc).isoformat()
    total = 0

    for m in members:
        ticker = m["symbol"]
        sponsor = SPONSOR_MAP.get(ticker) or (m.get("company_name") or "").split(",")[0]
        if not sponsor:
            continue

        trials = fetch_trials_for_sponsor(sponsor, max_records=TRIALS_PER_SPONSOR)
        if not trials:
            logger.info("  %s (%s): no trials", ticker, sponsor)
            continue

        rows = []
        for t in trials:
            row = dict(t)
            row["ticker"] = ticker
            row["updated_at"] = now
            rows.append(row)

        try:
            sb.table("pharma_trials").upsert(rows, on_conflict="nct_id").execute()
            total += len(rows)
            logger.info("  %s (%s): %d trials upserted", ticker, sponsor, len(rows))
        except Exception:
            logger.exception("Failed to upsert trials for %s", ticker)

    logger.info("=== Pharma Trials Ingest Complete: %d trials for %d sponsors ===", total, len(members))


if __name__ == "__main__":
    main()
