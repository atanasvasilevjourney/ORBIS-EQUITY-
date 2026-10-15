"""Sync Nasdaq-listed symbols from Nasdaq Trader symbol directory.

Upserts ``universe_members`` with tier ``us_nasdaq_listed`` (common stocks).
Run weekly after index universe sync so NDAQ ALL desk / watchlist screener resolve
the full exchange listing stored in Supabase.

Usage:
    python -m pipeline.ingest.nasdaq_listed
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from io import StringIO

import requests
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

logger = logging.getLogger(__name__)

NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"


def parse_nasdaq_listed_text(text: str) -> list[dict[str, str]]:
    """Parse pipe file; skip test issues and footer."""
    lines = [ln.strip() for ln in text.strip().splitlines() if ln.strip()]
    if not lines:
        return []
    out: list[dict[str, str]] = []
    for line in lines[1:]:
        if line.startswith("File Creation Time"):
            break
        parts = line.split("|")
        if len(parts) < 2:
            continue
        sym = parts[0].strip().upper().replace(".", "-")
        if not sym or sym == "Symbol":
            continue
        test_issue = parts[4].strip().upper() if len(parts) > 4 else "N"
        if test_issue == "Y":
            continue
        etf = parts[3].strip().upper() if len(parts) > 3 else "N"
        if etf == "Y":
            continue
        name = parts[1].strip() if len(parts) > 1 else sym
        out.append({"symbol": sym, "company_name": name})
    return out


def fetch_nasdaq_listed_symbols() -> list[dict[str, str]]:
    resp = requests.get(
        NASDAQ_LISTED_URL,
        timeout=60,
        headers={"User-Agent": "OrbisEquity-Universe/1.0"},
    )
    resp.raise_for_status()
    return parse_nasdaq_listed_text(resp.text)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")

    stocks = fetch_nasdaq_listed_symbols()
    if not stocks:
        raise RuntimeError("Nasdaq listed sync returned zero symbols")

    logger.info("Fetched %d Nasdaq-listed symbols from Trader directory", len(stocks))
    sb = create_client(url, key)
    now = datetime.now(timezone.utc).isoformat()
    allowed = {s["symbol"] for s in stocks}

    rows = [
        {
            "symbol": s["symbol"],
            "company_name": s["company_name"],
            "sector": None,
            "industry": None,
            "country": "US",
            "exchange": "NASDAQ",
            "currency": "USD",
            "tier": "us_nasdaq_listed",
            "data_source": "nasdaq_trader",
            "fundamentals_source": None,
            "is_active": True,
            "updated_at": now,
        }
        for s in stocks
    ]

    batch_size = 500
    for i in range(0, len(rows), batch_size):
        sb.table("universe_members").upsert(rows[i : i + batch_size], on_conflict="symbol").execute()

    existing = (
        sb.table("universe_members")
        .select("symbol")
        .eq("tier", "us_nasdaq_listed")
        .execute()
    )
    stale = [r["symbol"] for r in (existing.data or []) if r.get("symbol") not in allowed]
    for i in range(0, len(stale), batch_size):
        sb.table("universe_members").update({"is_active": False, "updated_at": now}).in_(
            "symbol", stale[i : i + batch_size]
        ).execute()

    logger.info(
        "Nasdaq listed sync done: %d active (%d deactivated)",
        len(rows),
        len(stale),
    )


if __name__ == "__main__":
    main()
