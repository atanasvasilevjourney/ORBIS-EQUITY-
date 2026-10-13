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
    """Build OHLCV frame using adjusted closes for signal math."""
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    if "adj_close" in df.columns:
        df = df.copy()
        df["close"] = df["adj_close"].where(df["adj_close"].notna(), df["close"])
    for col in ("open", "high", "low", "close", "volume"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df.sort_values("date") if "date" in df.columns else df
