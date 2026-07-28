"""Financial reports ingest: LSE z_financial_reports → Supabase.

Fetches income statements, balance sheets, cash flows, growth rates,
and key metrics for all universe members.  Stores in financial_reports
table with the raw JSONB data blob for maximum flexibility.

Usage:
    python -m pipeline.ingest.financial_reports
"""
import logging
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client, Client

from pipeline.config.settings import LSEConfig, SupabaseConfig, FINANCIAL_REPORT_TYPES
from pipeline.clients.lse_api import LSEClient

load_dotenv()

logger = logging.getLogger(__name__)

REPORT_TYPES = FINANCIAL_REPORT_TYPES  # income, balance, cashflow, growth, metrics


def _get_supabase_client() -> Client:
    cfg = SupabaseConfig()
    if not cfg.url or not cfg.service_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in environment"
        )
    return create_client(cfg.url, cfg.service_key)


def _fetch_universe_symbols(sb: Client) -> list[str]:
    """Get all active universe symbols."""
    resp = sb.table("universe_members").select("symbol").eq("is_active", True).execute()
    return [r["symbol"] for r in (resp.data or [])]


def _ingest_reports_for_type(
    lse: LSEClient, sb: Client, symbols: list[str], report_type: str
) -> int:
    """Fetch and upsert all reports of a given type for all symbols.

    We fetch in bulk (no per-symbol calls) since LSE API supports
    pagination and filtering by report_type.
    """
    logger.info("Fetching %s reports from LSE API...", report_type)

    try:
        raw_reports = lse.get_financial_reports(
            report_type=report_type, period="FY", limit=5000
        )
    except Exception:
        logger.exception("Failed to fetch %s reports", report_type)
        return 0

    logger.info("Received %d raw %s reports", len(raw_reports), report_type)

    # Filter to universe symbols only
    universe_set = set(symbols)
    rows: list[dict] = []

    for report in raw_reports:
        symbol = report.get("symbol")
        if not symbol or symbol not in universe_set:
            continue

        data_blob = report.get("data", {})
        if not data_blob:
            continue

        rows.append({
            "symbol": symbol,
            "report_type": report_type,
            "date": report.get("date"),
            "period": report.get("period", "FY"),
            "fiscal_year": report.get("fiscal_year"),
            "reported_currency": report.get("reported_currency"),
            "cik": report.get("cik"),
            "filing_date": report.get("filing_date"),
            "data": data_blob,
        })

    logger.info("Mapped %d %s reports for universe symbols", len(rows), report_type)

    # Batch upsert
    batch_size = 200
    upserted = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            sb.table("financial_reports").upsert(
                batch, on_conflict="symbol,report_type,date,period"
            ).execute()
            upserted += len(batch)
            logger.info(
                "%s reports upserted %d/%d",
                report_type, upserted, len(rows),
            )
        except Exception:
            logger.exception(
                "Failed to upsert %s batch %d-%d", report_type, i, i + len(batch)
            )

    return upserted


def main() -> None:
    """Fetch all financial report types and upsert into Supabase."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== Financial Reports Ingest Start ===")

    lse = LSEClient()
    sb = _get_supabase_client()

    symbols = _fetch_universe_symbols(sb)
    logger.info("Universe has %d active symbols", len(symbols))

    totals: dict[str, int] = {}
    for rt in REPORT_TYPES:
        count = _ingest_reports_for_type(lse, sb, symbols, rt)
        totals[rt] = count

    total = sum(totals.values())
    breakdown = ", ".join(f"{k}={v}" for k, v in totals.items())
    logger.info("=== Financial Reports Ingest Complete: %d total (%s) ===", total, breakdown)


if __name__ == "__main__":
    main()
