"""GDELT DOC API v2 client for news headlines.

Free API, no key required. Rate limit: 1 request per 5 seconds.
Returns articles with tone scores (positive/negative sentiment).

API docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
REQUEST_DELAY = float(os.getenv("GDELT_REQUEST_DELAY_SEC", "5.5"))
MAX_ATTEMPTS = int(os.getenv("GDELT_MAX_ATTEMPTS", "3"))


def _parse_gdelt_payload(text: str) -> dict[str, Any] | None:
    stripped = (text or "").strip()
    if not stripped:
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return None


def fetch_news_for_ticker(
    ticker: str,
    max_records: int = 10,
    timespan: str = "7d",
) -> list[dict]:
    """Fetch recent news articles for a ticker from GDELT."""
    raw_term = ticker.split(".")[0]
    if len(raw_term) <= 2:
        search_term = f'"{raw_term}" stock OR shares'
    else:
        search_term = f'"{raw_term}"'

    params = {
        "query": f"{search_term} sourcelang:english",
        "mode": "artlist",
        "maxrecords": str(max_records),
        "format": "json",
        "timespan": timespan,
    }

    data: dict[str, Any] | None = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            resp = requests.get(BASE_URL, params=params, timeout=30)
            if resp.status_code == 429:
                wait = REQUEST_DELAY * (attempt + 2)
                logger.warning("GDELT rate limited for %s (attempt %d), sleeping %.1fs", ticker, attempt + 1, wait)
                time.sleep(wait)
                continue
            if resp.status_code >= 500:
                wait = REQUEST_DELAY * (attempt + 1)
                logger.warning(
                    "GDELT HTTP %s for %s (attempt %d), sleeping %.1fs",
                    resp.status_code,
                    ticker,
                    attempt + 1,
                    wait,
                )
                time.sleep(wait)
                continue
            resp.raise_for_status()
            data = _parse_gdelt_payload(resp.text)
            if data is None:
                logger.warning(
                    "GDELT empty/non-JSON body for %s (attempt %d), len=%d",
                    ticker,
                    attempt + 1,
                    len(resp.text or ""),
                )
                time.sleep(REQUEST_DELAY * (attempt + 1))
                continue
            break
        except requests.RequestException:
            logger.warning("GDELT request failed for %s (attempt %d)", ticker, attempt + 1, exc_info=True)
            time.sleep(REQUEST_DELAY * (attempt + 1))
        except Exception:
            logger.exception("Unexpected GDELT error for %s", ticker)
            return []

    if not data:
        time.sleep(REQUEST_DELAY)
        return []

    articles = data.get("articles") or []
    results: list[dict] = []

    for art in articles:
        tone_str = art.get("tone", "0")
        try:
            tone_parts = str(tone_str).split(",")
            tone = float(tone_parts[0])
        except (ValueError, IndexError):
            tone = 0.0

        results.append(
            {
                "url": art.get("url", ""),
                "title": (art.get("title") or "")[:200],
                "source": (art.get("domain") or art.get("source", ""))[:100],
                "tone": round(tone, 2),
                "datetime": art.get("seendate", ""),
                "language": art.get("language", "English"),
            }
        )

    time.sleep(REQUEST_DELAY)
    return results