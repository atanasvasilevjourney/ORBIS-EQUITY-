"""Universe sync: classify LSE screener stocks into tiers, upsert to Supabase.

Fetches all stocks from the LSE screener API, classifies US stocks by
S&P 500/400/600 index membership (scraped from Wikipedia), tags UK and EU
stocks by country code, and upserts the full universe into the
universe_members table.

Usage:
    python -m pipeline.ingest.universe
"""
import logging
import os
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv
from supabase import create_client, Client

from pipeline.config.settings import LSEConfig, SupabaseConfig, UNIVERSE_TIERS
from pipeline.clients.lse_api import LSEClient

load_dotenv()

logger = logging.getLogger(__name__)

# Wikipedia pages for S&P constituent lists
SP500_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
SP400_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_400_companies"
SP600_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_600_companies"

EU_COUNTRIES = {"DE", "FR", "NL", "ES", "IT", "CH", "IE"}


def _scrape_sp_tickers(url: str) -> set[str]:
    """Scrape S&P constituent tickers from a Wikipedia page.

    Each page has an HTML table where the first column contains the ticker
    symbol.  We parse that column out of the first <table> with class
    'wikitable' on the page.
    """
    tickers: set[str] = set()
    try:
        resp = requests.get(url, timeout=30, headers={
            "User-Agent": "KovaView-Pipeline/1.0"
        })
        resp.raise_for_status()
        html = resp.text

        # Find the first wikitable
        table_start = html.find('<table class="wikitable')
        if table_start == -1:
            # Fallback: try any wikitable sortable
            table_start = html.find('<table class="wikitable sortable')
        if table_start == -1:
            logger.warning("No wikitable found at %s", url)
            return tickers

        table_end = html.find("</table>", table_start)
        table_html = html[table_start:table_end]

        # Parse rows — skip the header row
        rows = table_html.split("<tr>")[2:]  # [0] is before first <tr>, [1] is header
        for row in rows:
            # Extract first <td> content
            td_start = row.find("<td>")
            if td_start == -1:
                continue
            td_end = row.find("</td>", td_start)
            cell = row[td_start + 4:td_end]

            # Strip HTML tags to get the ticker text
            ticker = _strip_html_tags(cell).strip()
            # Normalize: some Wikipedia entries use dots (BRK.B), our API uses hyphens
            ticker = ticker.replace(".", "-") if ticker else ticker
            if ticker:
                tickers.add(ticker)

        logger.info("Scraped %d tickers from %s", len(tickers), url)
    except Exception:
        logger.exception("Failed to scrape S&P tickers from %s", url)
    return tickers


def _strip_html_tags(text: str) -> str:
    """Remove HTML tags from a string."""
    result = []
    in_tag = False
    for ch in text:
        if ch == "<":
            in_tag = True
        elif ch == ">":
            in_tag = False
        elif not in_tag:
            result.append(ch)
    return "".join(result)


def _build_sp_indices() -> dict[str, set[str]]:
    """Scrape S&P 500, 400, 600 constituent lists from Wikipedia."""
    logger.info("Scraping S&P index constituents from Wikipedia...")
    return {
        "us_large": _scrape_sp_tickers(SP500_URL),
        "us_mid": _scrape_sp_tickers(SP400_URL),
        "us_small": _scrape_sp_tickers(SP600_URL),
    }


def classify_stock(stock: dict, sp_indices: dict[str, set[str]]) -> str:
    """Determine the universe tier for a single stock.

    Priority:
        1. country == 'GB' -> 'uk'
        2. country in EU_COUNTRIES -> 'eu'
        3. symbol in S&P 500 -> 'us_large'
        4. symbol in S&P 400 -> 'us_mid'
        5. symbol in S&P 600 -> 'us_small'
        6. country == 'US' -> 'us_micro'
        7. everything else -> 'other'
    """
    country = (stock.get("country") or "").upper()
    symbol = stock.get("symbol", "")

    if country == "GB":
        return "uk"
    if country in EU_COUNTRIES:
        return "eu"

    # US classification by index membership
    if symbol in sp_indices.get("us_large", set()):
        return "us_large"
    if symbol in sp_indices.get("us_mid", set()):
        return "us_mid"
    if symbol in sp_indices.get("us_small", set()):
        return "us_small"

    if country == "US":
        return "us_micro"

    return "other"


def _get_supabase_client() -> Client:
    """Create and return a Supabase client from env config."""
    cfg = SupabaseConfig()
    if not cfg.url or not cfg.service_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in environment"
        )
    return create_client(cfg.url, cfg.service_key)


def main() -> None:
    """Fetch LSE screener, classify tickers, upsert into universe_members."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== Universe Sync Start ===")

    # 1. Fetch all stocks from LSE screener
    lse = LSEClient()
    logger.info("Fetching all screener data from LSE API...")
    stocks = lse.get_all_screener_data()
    logger.info("Received %d stocks from screener", len(stocks))

    if not stocks:
        logger.error("No stocks returned from screener — aborting.")
        return

    # 2. Scrape S&P index constituents for US tier classification
    sp_indices = _build_sp_indices()

    # 3. Classify each stock
    now = datetime.now(timezone.utc).isoformat()
    rows: list[dict] = []
    tier_counts: dict[str, int] = {}

    for stock in stocks:
        symbol = stock.get("symbol")
        if not symbol:
            continue

        tier = classify_stock(stock, sp_indices)
        tier_counts[tier] = tier_counts.get(tier, 0) + 1

        tier_info = UNIVERSE_TIERS.get(tier)
        price_source = tier_info.source if tier_info else "lse"
        fundamentals_source = tier_info.fundamentals_source if tier_info else "lse"

        rows.append({
            "symbol": symbol,
            "company_name": stock.get("company_name"),
            "sector": stock.get("sector"),
            "industry": stock.get("industry"),
            "country": stock.get("country"),
            "exchange": stock.get("exchange"),
            "currency": stock.get("currency"),
            "tier": tier,
            "price_source": price_source,
            "fundamentals_source": fundamentals_source,
            "is_active": stock.get("is_actively_trading", True),
            "market_cap": stock.get("market_cap"),
            "updated_at": now,
        })

    logger.info("Tier distribution: %s", tier_counts)

    # 4. Upsert into Supabase universe_members table
    sb = _get_supabase_client()
    batch_size = 500
    upserted = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            sb.table("universe_members").upsert(
                batch, on_conflict="symbol"
            ).execute()
            upserted += len(batch)
            logger.info(
                "Upserted batch %d-%d (%d/%d)",
                i, i + len(batch), upserted, len(rows),
            )
        except Exception:
            logger.exception(
                "Failed to upsert batch %d-%d", i, i + len(batch)
            )

    logger.info(
        "=== Universe Sync Complete: %d/%d upserted ===", upserted, len(rows)
    )


if __name__ == "__main__":
    main()
