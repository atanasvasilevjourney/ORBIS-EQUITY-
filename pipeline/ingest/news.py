"""News ingest: GDELT → Supabase news_items.

Fetches recent headlines for top-ranked universe members from GDELT
DOC API. Limited to ~50 tickers per run due to GDELT rate limits
(1 req / 5 sec = ~12 tickers/min → 50 tickers = ~4 min).

Prioritizes tickers with recent state changes or high quality rank.

Usage:
    python -m pipeline.ingest.news
"""
import logging
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client, Client

from pipeline.config.settings import SupabaseConfig
from pipeline.clients.gdelt import fetch_news_for_ticker

load_dotenv()

logger = logging.getLogger(__name__)

MAX_TICKERS_PER_RUN = 50
ARTICLES_PER_TICKER = 5


def _get_supabase_client() -> Client:
    cfg = SupabaseConfig()
    if not cfg.url or not cfg.service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(cfg.url, cfg.service_key)


def _get_priority_tickers(sb: Client) -> list[str]:
    """Get tickers to fetch news for, prioritized by quality rank."""
    resp = (
        sb.table("trend_radar")
        .select("symbol, quality_rank")
        .order("quality_rank", desc=True)
        .limit(MAX_TICKERS_PER_RUN)
        .execute()
    )
    return [r["symbol"] for r in (resp.data or [])]


def main() -> None:
    """Fetch news headlines from GDELT and upsert into news_items."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== News Ingest Start ===")

    sb = _get_supabase_client()
    tickers = _get_priority_tickers(sb)
    logger.info("Fetching news for %d priority tickers", len(tickers))

    total_articles = 0
    now = datetime.now(timezone.utc).isoformat()

    for i, ticker in enumerate(tickers):
        logger.info("[%d/%d] Fetching news for %s...", i + 1, len(tickers), ticker)

        articles = fetch_news_for_ticker(
            ticker, max_records=ARTICLES_PER_TICKER, timespan="7d"
        )

        if not articles:
            continue

        rows = []
        for art in articles:
            if not art["title"] or not art["url"]:
                continue
            rows.append({
                "ticker": ticker,
                "published_at": art["datetime"] or now,
                "source": art["source"],
                "headline": art["title"][:200],
                "url": art["url"],
                "tone": art["tone"],
            })

        if rows:
            try:
                sb.table("news_items").insert(rows).execute()
                total_articles += len(rows)
                logger.info("  %s: %d articles inserted", ticker, len(rows))
            except Exception:
                logger.exception("Failed to insert news for %s", ticker)

    logger.info("=== News Ingest Complete: %d articles for %d tickers ===", total_articles, len(tickers))


if __name__ == "__main__":
    main()
