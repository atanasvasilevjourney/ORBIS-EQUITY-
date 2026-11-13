"""Adjusted close contract for ``prices_daily`` (Phase 1)."""
from __future__ import annotations

from typing import Any, Mapping

import pandas as pd


def effective_close(row: Mapping[str, Any]) -> float | None:
    """Prefer ``adj_close``; fall back to ``close``."""
    ac = row.get("adj_close")
    c = row.get("close")
    for val in (ac, c):
        if val is None:
            continue
        try:
            f = float(val)
            if pd.notna(f):
                return f
        except (TypeError, ValueError):
            continue
    return None


def finalize_price_row(row: dict[str, Any]) -> dict[str, Any]:
    """Ensure ``adj_close`` is populated on ingest upserts."""
    out = dict(row)
    c = out.get("close")
    ac = out.get("adj_close")
    if ac is None and c is not None:
        try:
            out["adj_close"] = float(c)
        except (TypeError, ValueError):
            pass
    elif ac is not None and c is None:
        try:
            out["close"] = float(ac)
        except (TypeError, ValueError):
            pass
    return out


def ohlcv_frame(rows: list[dict[str, Any]]) -> pd.DataFrame:
    """Build OHLCV frame on the adjusted-close scale for signal math.

    Open, high, and low are scaled by ``adj_close / close`` so Donchian and
    VWAP stay on one scale after splits and dividends.
    """
    if not rows:
        return pd.DataFrame()
    from pipeline.ema200_scanner.data.adjust import scale_ohlcv_frame

    df = scale_ohlcv_frame(pd.DataFrame(rows))
    return df.sort_values("date") if "date" in df.columns else df
