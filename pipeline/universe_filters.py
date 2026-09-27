"""Shared universe eligibility rules for LOOP / Trend Radar tradable set."""
from __future__ import annotations

PHARMA_INDUSTRY_KEYWORDS = (
    "pharmaceutical",
    "biotechnology",
    "drug manufacturer",
)


def is_pharma_stock(row: dict) -> bool:
    """True for pharmaceutical / biotech names (excluded from LOOP universe)."""
    industry = (row.get("industry") or "").lower()
    if any(k in industry for k in PHARMA_INDUSTRY_KEYWORDS):
        return True
    sector = (row.get("sector") or "").lower()
    if sector in {"pharmaceuticals", "biotechnology"}:
        return True
    return False


def is_loop_tradable(row: dict) -> bool:
    """Active US index name and not pharma."""
    if not row.get("is_active", True):
        return False
    tier = row.get("tier") or ""
    if tier not in {"us_large", "us_nasdaq100"}:
        return False
    return not is_pharma_stock(row)
