"""Merged point-in-time S&P 500 ∪ Nasdaq-100 with dual-listing dedupe."""
from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import date

from pipeline.research.nasdaq100_pit import membership_lookup as ndx_lookup
from pipeline.research.sp500_pit import membership_lookup as sp_lookup
from pipeline.universe_filters import is_loop_tradable

logger = logging.getLogger(__name__)

# When both share classes appear, keep the preferred symbol (drop the other).
DUAL_LISTING_PREFERRED: dict[frozenset[str], str] = {
    frozenset({"GOOG", "GOOGL"}): "GOOGL",
    frozenset({"BRK-A", "BRK-B"}): "BRK-B",
    frozenset({"FOX", "FOXA"}): "FOXA",
    frozenset({"NWS", "NWSA"}): "NWSA",
    frozenset({"LEN", "LEN-B"}): "LEN",
    frozenset({"UA", "UAA"}): "UAA",
}
PREFER_SYMBOL: dict[str, str] = {}
for grp, preferred in DUAL_LISTING_PREFERRED.items():
    for sym in grp:
        if sym != preferred:
            PREFER_SYMBOL[sym] = preferred


def dedupe_share_classes(symbols: set[str]) -> set[str]:
    out = set(symbols)
    for sym in list(out):
        if sym in PREFER_SYMBOL:
            out.discard(sym)
    return out


def merged_symbols_as_of(
    as_of: date,
    *,
    sp_path=None,
    ndx_path=None,
) -> set[str]:
    sp = sp_lookup(sp_path)(as_of)
    ndx = ndx_lookup(ndx_path)(as_of)
    merged = sp | ndx
    return dedupe_share_classes(merged)


def merged_membership_lookup(
    sp_path=None,
    ndx_path=None,
) -> Callable[[date], set[str]]:
    def _lookup(d: date) -> set[str]:
        return merged_symbols_as_of(d, sp_path=sp_path, ndx_path=ndx_path)

    return _lookup


def union_symbols_between(
    start: date,
    end: date,
    *,
    sp_path=None,
    ndx_path=None,
) -> set[str]:
    """All symbols ever in the merged index over [start, end] (for OHLCV download)."""
    from pipeline.research.sp500_pit import union_symbols_between as sp_union

    sp = sp_union(start, end, path=sp_path)
    ndx: set[str] = set()
    d = start
    while d <= end:
        ndx |= ndx_lookup(ndx_path)(d)
        d = date.fromordinal(d.toordinal() + 7)
    return dedupe_share_classes(sp | ndx)


def filter_tradable_symbols(symbols: set[str]) -> set[str]:
    """Drop ETFs / non-US tiers — index members are treated as US equities."""
    out: set[str] = set()
    for sym in symbols:
        row = {"symbol": sym, "tier": "us_large", "is_active": True}
        if is_loop_tradable(row):
            out.add(sym)
    return out