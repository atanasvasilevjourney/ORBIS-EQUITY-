"""Put OHLC on the adjusted-close scale before EMA / ATR math.

``prices_daily`` stores raw open/high/low/close plus ``adj_close``. Replacing
only the close leaves the EMA200-of-high (the ribbon's upper edge) and ATR on
raw prints. Across a split those series live on different scales, so ribbon
distance collapses toward zero and names that are nowhere near the 200 EMA
look like touches.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def scale_ohlcv_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Scale open/high/low/close by ``adj_close / close`` (factor 1 when unadjusted)."""
    if df.empty or "close" not in df.columns:
        return df.copy()

    out = df.copy()
    close = pd.to_numeric(out["close"], errors="coerce")
    if "adj_close" in out.columns:
        adj = pd.to_numeric(out["adj_close"], errors="coerce")
    else:
        adj = pd.Series(np.nan, index=out.index, dtype=float)
    use_adj = adj.where(adj.notna(), close)
    denom = close.where(close != 0)
    factor = (use_adj / denom).replace([np.inf, -np.inf], np.nan).fillna(1.0)
    for col in ("open", "high", "low"):
        if col in out.columns:
            out[col] = pd.to_numeric(out[col], errors="coerce") * factor
    out["close"] = use_adj
    if "volume" in out.columns:
        out["volume"] = pd.to_numeric(out["volume"], errors="coerce").fillna(0)
    return out
