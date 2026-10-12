"""Sync US tradable universe: S&P 500 + Nasdaq-100, excluding pharma/biotech.

Upserts `universe_members` and deactivates names outside the merged index set
or flagged as pharmaceutical / biotechnology.

Usage:
    python -m pipeline.ingest.us_index_universe
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from io import StringIO

import pandas as pd
import requests
from dotenv import load_dotenv
from supabase import create_client

from pipeline.universe_filters import is_pharma_stock

load_dotenv()

logger = logging.getLogger(__name__)

SP500_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
NDX100_API = "https://api.nasdaq.com/api/quote/list-type/nasdaq100"


def _fetch_nasdaq100() -> list[dict]:
    """Official Nasdaq-100 constituent list (symbol + name)."""
    resp = requests.get(
        NDX100_API,
        timeout=30,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; OrbisEquity-Universe/1.0)",
            "Accept": "application/json",
        },
    )
    resp.raise_for_status()
    payload = resp.json()
    rows = payload.get("data", {}).get("data", {}).get("rows") or []
    out: list[dict] = []
    for row in rows:
        symbol = str(row.get("symbol", "")).strip().replace(".", "-")
        if not symbol:
            continue
        out.append(
            {
                "symbol": symbol,
                "company_name": str(row.get("companyName") or ""),
                "sector": str(row.get("sector") or ""),
                "industry": "",
            }
        )
    logger.info("Fetched %d Nasdaq-100 symbols from Nasdaq API", len(out))
    return out


def _scrape_table(url: str, *, user_agent: str = "OrbisEquity-Universe/1.0") -> list[dict]:
    resp = requests.get(url, timeout=30, headers={"User-Agent": user_agent})
    resp.raise_for_status()
    tables = pd.read_html(StringIO(resp.text))
    if not tables:
        return []
    df = tables[0]
    colmap = {str(c).lower(): c for c in df.columns}
    sym_col = colmap.get("symbol") or colmap.get("ticker") or df.columns[0]
    name_col = colmap.get("security") or colmap.get("company") or colmap.get("name")
    sector_col = colmap.get("gics sector") or colmap.get("sector")
    industry_col = colmap.get("gics sub-industry") or colmap.get("gics sub industry") or colmap.get("sub-industry")

    rows: list[dict] = []
    for _, row in df.iterrows():
        symbol = str(row.get(sym_col, "")).strip().replace(".", "-")
        if not symbol or symbol.lower() in {"symbol", "ticker"}:
            continue
        rows.append(
            {
                "symbol": symbol,
                "company_name": str(row.get(name_col, "")) if name_col is not None else "",
                "sector": str(row.get(sector_col, "")) if sector_col is not None else "",
                "industry": str(row.get(industry_col, "")) if industry_col is not None else "",
            }
        )
    return rows


def build_merged_universe() -> tuple[list[dict], dict[str, int]]:
    sp500 = _scrape_table(SP500_URL)
    ndx = _fetch_nasdaq100()
    sp_syms = {s["symbol"] for s in sp500}
    merged: dict[str, dict] = {}
    for s in sp500:
        merged[s["symbol"]] = {**s, "tier": "us_large", "exchange": "NYSE"}
    ndx_only = 0
    for s in ndx:
        if s["symbol"] in merged:
            merged[s["symbol"]]["exchange"] = "NASDAQ"
            continue
        merged[s["symbol"]] = {**s, "tier": "us_nasdaq100", "exchange": "NASDAQ"}
        ndx_only += 1

    stats = {
        "sp500": len(sp500),
        "nasdaq100": len(ndx),
        "merged": len(merged),
        "nasdaq100_only": ndx_only,
        "pharma_excluded": 0,
    }
    return list(merged.values()), stats


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== US Index Universe Sync (S&P 500 + Nasdaq-100, no pharma) ===")

    stocks, stats = build_merged_universe()
    logger.info(
        "Scraped sp500=%d nasdaq100=%d merged=%d (+%d Nasdaq-only)",
        stats["sp500"],
        stats["nasdaq100"],
        stats["merged"],
        stats["nasdaq100_only"],
    )

    sb_url = os.getenv("SUPABASE_URL", "")
    sb_key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not sb_url or not sb_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    sb = create_client(sb_url, sb_key)

    now = datetime.now(timezone.utc).isoformat()
    allowed: set[str] = set()
    rows: list[dict] = []
    for s in stocks:
        pharma = is_pharma_stock(s)
        if pharma:
            stats["pharma_excluded"] += 1
        active = not pharma
        if active:
            allowed.add(s["symbol"])
        rows.append(
            {
                "symbol": s["symbol"],
                "company_name": s["company_name"],
                "sector": s["sector"],
                "industry": s["industry"],
                "country": "US",
                "exchange": s["exchange"],
                "currency": "USD",
                "tier": s["tier"],
                "data_source": "yfinance",
                "fundamentals_source": "yfinance",
                "is_active": active,
                "updated_at": now,
            }
        )

    batch_size = 500
    for i in range(0, len(rows), batch_size):
        sb.table("universe_members").upsert(rows[i : i + batch_size], on_conflict="symbol").execute()

    # Deactivate prior US index names that are pharma or dropped from the merge
    existing = sb.table("universe_members").select("symbol, tier").in_(
        "tier", ["us_large", "us_nasdaq100", "us_mid", "us_small", "us_micro"]
    ).execute().data or []
    to_deactivate = [
        r["symbol"]
        for r in existing
        if r["symbol"] not in allowed and r.get("tier") in {"us_large", "us_nasdaq100"}
    ]
    for i in range(0, len(to_deactivate), batch_size):
        sb.table("universe_members").update({"is_active": False, "updated_at": now}).in_(
            "symbol", to_deactivate[i : i + batch_size]
        ).execute()

    logger.info(
        "=== Universe sync complete: %d active index names, %d pharma excluded, %d deactivated stale ===",
        len(allowed),
        stats["pharma_excluded"],
        len(to_deactivate),
    )


if __name__ == "__main__":
    main()
