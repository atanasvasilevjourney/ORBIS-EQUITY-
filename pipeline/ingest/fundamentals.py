"""Fundamentals ingest: screener metrics + insider trades to Supabase.

Fetches the full LSE screener dataset (1,472 stocks, 50+ metrics) and
upserts into fundamentals_snapshot.  Also fetches recent insider trades
(last 30 days) and upserts into insider_trades_snapshot.

Usage:
    python -m pipeline.ingest.fundamentals
"""
import logging
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client, Client

from pipeline.config.settings import LSEConfig, SupabaseConfig, SCREENER_FIELDS
from pipeline.clients.lse_api import LSEClient

load_dotenv()

logger = logging.getLogger(__name__)

# Mapping from LSE screener field names to fundamentals_snapshot columns.
# Keys = screener API field, Values = Supabase column name.
# Where names match 1:1, the mapping is identity.  Adjust if the DB schema
# uses different column names.
FUNDAMENTALS_FIELD_MAP: dict[str, str] = {
    "symbol": "symbol",
    "company_name": "company_name",
    "sector": "sector",
    "industry": "industry",
    "country": "country",
    "exchange": "exchange",
    "currency": "currency",
    "price": "price",
    "market_cap": "market_cap",
    "beta": "beta",
    "volume": "volume",
    "average_volume": "average_volume",
    "week_52_low": "week_52_low",
    "week_52_high": "week_52_high",
    # Valuation
    "pe_ratio": "pe_ratio",
    "pb_ratio": "pb_ratio",
    "ps_ratio": "ps_ratio",
    "p_fcf_ratio": "p_fcf_ratio",
    "ev_ebitda": "ev_ebitda",
    "ev_sales": "ev_sales",
    "earnings_yield": "earnings_yield",
    "fcf_yield": "fcf_yield",
    # Dividends
    "dividend_yield": "dividend_yield",
    "dividend_payout_ratio": "dividend_payout_ratio",
    "dividend_per_share": "dividend_per_share",
    # Profitability
    "gross_margin": "gross_margin",
    "operating_margin": "operating_margin",
    "net_margin": "net_margin",
    "roe": "roe",
    "roa": "roa",
    "roic": "roic",
    # Balance sheet
    "current_ratio": "current_ratio",
    "quick_ratio": "quick_ratio",
    "cash_ratio": "cash_ratio",
    "debt_to_equity": "debt_to_equity",
    "debt_to_assets": "debt_to_assets",
    # Income
    "revenue": "revenue",
    "gross_profit": "gross_profit",
    "operating_income": "operating_income",
    "net_income": "net_income",
    "ebitda": "ebitda",
    "eps": "eps",
    "eps_diluted": "eps_diluted",
    # Growth
    "revenue_growth_1y": "revenue_growth_1y",
    "revenue_growth_3y": "revenue_growth_3y",
    "revenue_growth_5y": "revenue_growth_5y",
    "net_income_growth_1y": "net_income_growth_1y",
    "net_income_growth_3y": "net_income_growth_3y",
    "net_income_growth_5y": "net_income_growth_5y",
    "eps_growth_1y": "eps_growth_1y",
    "dividend_growth_1y": "dividend_growth_1y",
    "book_value_growth_1y": "book_value_growth_1y",
    # Meta
    "is_etf": "is_etf",
    "is_actively_trading": "is_actively_trading",
    "ipo_date": "ipo_date",
    "ratios_date": "ratios_date",
}

# Insider trades field mapping (LSE API -> insider_trades_snapshot columns)
INSIDER_FIELD_MAP: dict[str, str] = {
    "symbol": "symbol",
    "filing_date": "filing_date",
    "transaction_date": "transaction_date",
    "reporting_name": "reporting_name",
    "transaction_type": "transaction_type",
    "securities_owned": "securities_owned",
    "securities_transacted": "securities_transacted",
    "price": "price",
    "company_name": "company_name",
    "type_of_owner": "type_of_owner",
    "acquistionOrDisposition": "acquisition_or_disposition",
    "form_type": "form_type",
    "link": "link",
}


def _get_supabase_client() -> Client:
    """Create and return a Supabase client from env config."""
    cfg = SupabaseConfig()
    if not cfg.url or not cfg.service_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in environment"
        )
    return create_client(cfg.url, cfg.service_key)


def _map_row(raw: dict, field_map: dict[str, str]) -> dict:
    """Map a raw API row to DB columns using the given field map."""
    mapped: dict = {}
    for src_key, dst_key in field_map.items():
        if src_key in raw:
            mapped[dst_key] = raw[src_key]
    return mapped


def _ingest_fundamentals(lse: LSEClient, sb: Client) -> int:
    """Fetch screener data and upsert into fundamentals_snapshot.

    Returns the number of rows successfully upserted.
    """
    logger.info("Fetching all screener data from LSE API...")
    stocks = lse.get_all_screener_data()
    logger.info("Received %d stocks from screener", len(stocks))

    if not stocks:
        logger.warning("No screener data returned — skipping fundamentals upsert.")
        return 0

    now = datetime.now(timezone.utc).isoformat()
    rows: list[dict] = []

    for stock in stocks:
        symbol = stock.get("symbol")
        if not symbol:
            continue

        row = _map_row(stock, FUNDAMENTALS_FIELD_MAP)
        row["snapshot_date"] = now
        row["updated_at"] = now
        rows.append(row)

    logger.info("Mapped %d fundamental rows for upsert", len(rows))

    # Batch upsert
    batch_size = 500
    upserted = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            sb.table("fundamentals_snapshot").upsert(
                batch, on_conflict="symbol"
            ).execute()
            upserted += len(batch)
            logger.info(
                "Fundamentals upserted batch %d-%d (%d/%d)",
                i, i + len(batch), upserted, len(rows),
            )
        except Exception:
            logger.exception(
                "Failed to upsert fundamentals batch %d-%d", i, i + len(batch)
            )

    return upserted


def _ingest_insider_trades(lse: LSEClient, sb: Client) -> int:
    """Fetch insider trades (last 30 days) and upsert into insider_trades_snapshot.

    Returns the number of rows successfully upserted.
    """
    logger.info("Fetching insider trades (last 30 days) from LSE API...")
    try:
        trades = lse.get_insider_trades(days_back=30)
    except Exception:
        logger.exception("Failed to fetch insider trades from LSE API")
        return 0

    logger.info("Received %d insider trade records", len(trades))

    if not trades:
        logger.info("No insider trades in the last 30 days.")
        return 0

    now = datetime.now(timezone.utc).isoformat()
    rows: list[dict] = []

    for trade in trades:
        symbol = trade.get("symbol")
        if not symbol:
            continue

        row = _map_row(trade, INSIDER_FIELD_MAP)
        row["updated_at"] = now

        # Ensure we have a filing_date for conflict resolution
        if not row.get("filing_date"):
            continue

        rows.append(row)

    logger.info("Mapped %d insider trade rows for upsert", len(rows))

    # Batch upsert
    batch_size = 500
    upserted = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            sb.table("insider_trades_snapshot").upsert(
                batch, on_conflict="symbol,filing_date,reporting_name"
            ).execute()
            upserted += len(batch)
            logger.info(
                "Insider trades upserted batch %d-%d (%d/%d)",
                i, i + len(batch), upserted, len(rows),
            )
        except Exception:
            logger.exception(
                "Failed to upsert insider trades batch %d-%d", i, i + len(batch)
            )

    return upserted


def main() -> None:
    """Fetch fundamentals + insider trades and upsert into Supabase."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== Fundamentals Ingest Start ===")

    lse = LSEClient()
    sb = _get_supabase_client()

    # 1. Fundamentals snapshot
    fund_count = _ingest_fundamentals(lse, sb)
    logger.info("Fundamentals: %d rows upserted", fund_count)

    # 2. Insider trades snapshot
    insider_count = _ingest_insider_trades(lse, sb)
    logger.info("Insider trades: %d rows upserted", insider_count)

    logger.info(
        "=== Fundamentals Ingest Complete: %d fundamentals, %d insider trades ===",
        fund_count, insider_count,
    )


if __name__ == "__main__":
    main()
