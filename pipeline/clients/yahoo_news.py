"""Yahoo Finance headlines via yfinance (fallback when GDELT fails)."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def _parse_pub_date(raw: str | int | None) -> str | None:
    if raw is None:
        return None
    try:
        if isinstance(raw, (int, float)):
            return datetime.fromtimestamp(raw, tz=timezone.utc).isoformat()
        text = str(raw).strip()
        if text.endswith("Z"):
            text = text.replace("Z", "+00:00")
        return datetime.fromisoformat(text).astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def fetch_yahoo_news_for_ticker(ticker: str, max_records: int = 5) -> list[dict]:
    try:
        import yfinance as yf
    except ImportError:
        return []

    try:
        raw = yf.Ticker(ticker).news or []
    except Exception:
        logger.warning("Yahoo news failed for %s", ticker, exc_info=True)
        return []

    results: list[dict] = []
    for item in raw[:max_records]:
        content = item.get("content") if isinstance(item, dict) else None
        if not isinstance(content, dict):
            continue
        title = (content.get("title") or "").strip()
        if not title:
            continue
        url = ""
        for key in ("canonicalUrl", "clickThroughUrl"):
            block = content.get(key)
            if isinstance(block, dict) and block.get("url"):
                url = str(block["url"])
                break
        if not url:
            continue
        provider = content.get("provider") or {}
        source = (provider.get("displayName") or "Yahoo Finance")[:100]
        published = _parse_pub_date(content.get("pubDate") or content.get("displayTime"))
        results.append(
            {
                "url": url,
                "title": title[:200],
                "source": source,
                "tone": 0.0,
                "datetime": published or datetime.now(timezone.utc).isoformat(),
                "language": "English",
            }
        )
    return results