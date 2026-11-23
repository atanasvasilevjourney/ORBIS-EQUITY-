"""News ingest: GDELT primary, Yahoo Finance fallback → Supabase news_items.

Usage:
    python -m pipeline.ingest.news
"""
from __future__ import annotations

import logging
import os
import sys
import time
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from supabase import Client, create_client

from pipeline.clients.gdelt import fetch_news_for_ticker
from pipeline.clients.yahoo_news import fetch_yahoo_news_for_ticker
from pipeline.config.settings import SupabaseConfig
from pipeline.utils.ci_log import append_step_summary_json, gh_warning

load_dotenv()

logger = logging.getLogger(__name__)

MAX_TICKERS_PER_RUN = 50
ARTICLES_PER_TICKER = 5


def _float_env(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _get_supabase_client() -> Client:
    cfg = SupabaseConfig()
    if not cfg.url or not cfg.service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(cfg.url, cfg.service_key)


def _get_priority_tickers(sb: Client) -> list[str]:
    resp = (
        sb.table("trend_radar")
        .select("symbol, quality_rank")
        .order("quality_rank", desc=True)
        .limit(MAX_TICKERS_PER_RUN)
        .execute()
    )
    tickers = [r["symbol"] for r in (resp.data or [])]
    if not tickers:
        fallback = (
            sb.table("universe_members")
            .select("symbol")
            .eq("is_active", True)
            .limit(MAX_TICKERS_PER_RUN)
            .execute()
        )
        tickers = [r["symbol"] for r in (fallback.data or [])]
        logger.info("trend_radar empty, falling back to %d universe members", len(tickers))
    return tickers


def _fetch_articles_for_ticker(ticker: str) -> tuple[list[dict], str]:
    articles = fetch_news_for_ticker(ticker, max_records=ARTICLES_PER_TICKER, timespan="7d")
    source = "gdelt"
    if not articles:
        articles = fetch_yahoo_news_for_ticker(ticker, max_records=ARTICLES_PER_TICKER)
        source = "yahoo" if articles else "none"
    return articles, source


def run_news_ingest(sb: Client | None = None) -> dict:
    sb = sb or _get_supabase_client()
    tickers = _get_priority_tickers(sb)
    logger.info("Fetching news for %d priority tickers", len(tickers))

    total_articles = 0
    gdelt_hits = 0
    yahoo_hits = 0
    failed = 0
    stopped_early = False
    now = datetime.now(timezone.utc).isoformat()
    max_sec = _float_env("NEWS_MAX_SEC", 0)
    t0 = time.monotonic()

    for i, ticker in enumerate(tickers):
        if max_sec > 0 and (time.monotonic() - t0) >= max_sec:
            stopped_early = True
            logger.warning(
                "Stopping early after %.0fs (NEWS_MAX_SEC) · %d/%d tickers",
                max_sec,
                i,
                len(tickers),
            )
            break
        logger.info("[%d/%d] Fetching news for %s...", i + 1, len(tickers), ticker)
        try:
            articles, src = _fetch_articles_for_ticker(ticker)
        except Exception:
            failed += 1
            logger.exception("News fetch failed for %s — skipping", ticker)
            continue

        if src == "gdelt" and articles:
            gdelt_hits += 1
        elif src == "yahoo" and articles:
            yahoo_hits += 1
        elif not articles:
            failed += 1
            continue

        rows = []
        for art in articles:
            if not art.get("title") or not art.get("url"):
                continue
            pub = art.get("datetime") or now
            rows.append(
                {
                    "ticker": ticker,
                    "published_at": pub,
                    "source": art.get("source") or src,
                    "headline": art["title"][:200],
                    "url": art["url"],
                    "tone": art.get("tone"),
                }
            )

        if rows:
            try:
                sb.table("news_items").upsert(rows, on_conflict="ticker,url").execute()
                total_articles += len(rows)
                logger.info("  %s: %d articles (%s)", ticker, len(rows), src)
            except Exception:
                failed += 1
                logger.exception("Failed to upsert news for %s", ticker)

    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        sb.table("news_items").delete().lt("published_at", cutoff).execute()
        logger.info("Purged news_items older than 30 days")
    except Exception:
        logger.warning("Failed to purge old news_items", exc_info=True)

    stats = {
        "tickers": len(tickers),
        "articles": total_articles,
        "gdelt_tickers": gdelt_hits,
        "yahoo_tickers": yahoo_hits,
        "empty_or_failed_tickers": failed,
        "stopped_early": stopped_early,
    }
    append_step_summary_json("News ingest", stats)

    if stopped_early:
        gh_warning(
            f"News ingest hit NEWS_MAX_SEC ({max_sec:.0f}s) after "
            f"{i}/{len(tickers)} tickers; raise job timeout or lower ticker cap if this persists."
        )

    if total_articles == 0:
        gh_warning(
            f"News ingest wrote 0 articles across {len(tickers)} tickers "
            f"(GDELT/Yahoo may be rate-limited)."
        )

    logger.info(
        "=== News Ingest Complete: %d articles | gdelt tickers=%d yahoo=%d failed=%d ===",
        total_articles,
        gdelt_hits,
        yahoo_hits,
        failed,
    )
    return stats


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== News Ingest Start ===")
    try:
        run_news_ingest()
    except Exception:
        logger.exception("News ingest crashed")
        sys.exit(1)


if __name__ == "__main__":
    main()