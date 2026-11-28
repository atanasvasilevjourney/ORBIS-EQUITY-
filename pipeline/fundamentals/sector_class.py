"""Sector classification for fundamentals scoring."""
from __future__ import annotations

FINANCIAL_SECTOR_KEYS = frozenset(
    {
        "financial",
        "financials",
        "financial services",
        "banks",
        "insurance",
        "capital markets",
    }
)


def is_financial_sector(sector: str | None, industry: str | None = None) -> bool:
    s = (sector or "").strip().lower()
    if s in FINANCIAL_SECTOR_KEYS or "financial" in s:
        return True
    ind = (industry or "").strip().lower()
    if any(k in ind for k in ("bank", "insurance", "exchange", "capital markets", "asset management")):
        return True
    return False