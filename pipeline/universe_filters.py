"""Shared universe eligibility rules for LOOP / Trend Radar tradable set."""
from __future__ import annotations

import re

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


_STRUCTURED_SUFFIX = re.compile(
    r"^(?:[A-Z]{1,5}[-.])?"
    r"[A-Z]{2,6}"
    r"(?:U|W|R|WS|WT|UW|AW|BW|WW)$"
)

_SPAC_NAME_HINTS = (
    " acquisition ",
    " blank check ",
    " spac ",
    " special purpose ",
    " warrant ",
    " unit ",
    " rights ",
)


def is_structured_product_symbol(symbol: str) -> bool:
    """Units, warrants, rights, and similar exchange listings not traded as common."""
    s = (symbol or "").upper().strip()
    if not s or len(s) < 3:
        return True
    if any(ch in s for ch in ("+", "^")):
        return True
    if s.count(".") > 0 and not s.endswith((".A", ".B")):
        return True
    if _STRUCTURED_SUFFIX.match(s):
        return True
    return False


def is_spac_shell_name(company_name: str | None) -> bool:
    name = f" {(company_name or '').lower()} "
    return any(h in name for h in _SPAC_NAME_HINTS)


def is_research_desk_eligible(row: dict) -> bool:
    """Index-desk common equity for ANALYZE / BIAS / CASH / watchlist breadth."""
    if not row.get("is_active", True):
        return False
    sym = row.get("symbol") or ""
    if is_structured_product_symbol(sym):
        return False
    if is_spac_shell_name(row.get("company_name")):
        return False
    tier = row.get("tier") or ""
    if tier not in {"us_large", "us_nasdaq100"}:
        return False
    return not is_pharma_stock(row)


def research_desk_symbols(rows: list[dict]) -> set[str]:
    return {r["symbol"] for r in rows if r.get("symbol") and is_research_desk_eligible(r)}
