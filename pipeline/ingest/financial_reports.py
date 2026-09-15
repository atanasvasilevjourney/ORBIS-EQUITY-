"""Financial reports ingest: LSE z_financial_reports → Supabase.

Fetches income statements, balance sheets, cash flows, growth rates,
and key metrics for all universe members.  Stores in financial_reports
table with the raw JSONB data blob for maximum flexibility.

Usage:
    python -m pipeline.ingest.financial_reports
"""
import logging

from dotenv import load_dotenv
from supabase import Client

from pipeline.config.settings import FINANCIAL_REPORT_TYPES
from pipeline.clients.lse_api import LSEClient
from pipeline.utils.supabase import fetch_active_symbols

load_dotenv()

logger = logging.getLogger(__name__)

REPORT_TYPES = FINANCIAL_REPORT_TYPES


def _get_supabase_client() -> Client:
    from pipeline.utils.client import get_supabase
    return get_supabase()



def _ingest_reports_for_type(
    lse: LSEClient, sb: Client, symbols: list[str], report_type: str
) -> int:
    """Fetch and upsert all reports of a given type (paginated)."""
    logger.info("Fetching %s reports from LSE API...", report_type)

    universe_set = set(symbols)
    rows: list[dict] = []
    offset = 0
    page_size = 5000

    while True:
        try:
            raw_reports = lse.get_financial_reports(
                report_type=report_type,
                period="FY",
                limit=page_size,
                offset=offset,
            )
        except Exception:
            logger.exception("Failed to fetch %s reports at offset %d", report_type, offset)
            break

        if not raw_reports:
            break

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

        logger.info("  %s: fetched %d rows (offset %d)", report_type, len(raw_reports), offset)
        if len(raw_reports) < page_size:
            break
        offset += page_size

    logger.info("Mapped %d %s reports for universe symbols", len(rows), report_type)

    batch_size = 200
    upserted = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            sb.table("financial_reports").upsert(
                batch, on_conflict="symbol,report_type,date,period"
            ).execute()
            upserted += len(batch)
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

    symbols = fetch_active_symbols(sb)
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
