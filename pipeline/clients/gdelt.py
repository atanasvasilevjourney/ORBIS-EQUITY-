"""GDELT DOC API v2 client for news headlines.

Free API, no key required. Rate limit: 1 request per 5 seconds.
Returns articles with tone scores (positive/negative sentiment).

API docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
"""
import logging
import time
from typing import Any

import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
REQUEST_DELAY = 5.5  # seconds between requests (GDELT limit is 5s)


def fetch_news_for_ticker(
    ticker: str,
    max_records: int = 10,
    timespan: str = "7d",
) -> list[dict]:
    """Fetch recent news articles for a ticker from GDELT.

    Args:
        ticker: Stock ticker symbol (e.g., "AAPL")
        max_records: Maximum articles to return
        timespan: Time window (e.g., "7d", "30d")

    Returns:
        List of article dicts with url, title, source, tone, datetime
    """
    # Strip exchange suffixes for search
    search_term = ticker.split(".")[0]

    params = {
        "query": f"{search_term} sourcelang:english",
        "mode": "artlist",
        "maxrecords": str(max_records),
        "format": "json",
        "timespan": timespan,
    }

    try:
        resp = requests.get(BASE_URL, params=params, timeout=30)
        if resp.status_code == 429:
            logger.warning("GDELT rate limited for %s, skipping", ticker)
            time.sleep(REQUEST_DELAY)
            return []
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        logger.exception("Failed to fetch GDELT news for %s", ticker)
        return []

    articles = data.get("articles", [])
    results: list[dict] = []

    for art in articles:
        tone_str = art.get("tone", "0")
        try:
            # GDELT tone is a comma-separated string: tone,positive,negative,...
            tone_parts = str(tone_str).split(",")
            tone = float(tone_parts[0])
        except (ValueError, IndexError):
            tone = 0.0

        results.append({
            "url": art.get("url", ""),
            "title": (art.get("title") or "")[:200],
            "source": (art.get("domain") or art.get("source", ""))[:100],
            "tone": round(tone, 2),
            "datetime": art.get("seendate", ""),
            "language": art.get("language", "English"),
        })

    time.sleep(REQUEST_DELAY)
    return results
