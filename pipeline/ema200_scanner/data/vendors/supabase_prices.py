"""Load OHLCV history from ``prices_daily`` (adjusted close when present)."""
from __future__ import annotations

import logging

import pandas as pd
from supabase import Client

from pipeline.utils.supabase import fetch_all

logger = logging.getLogger(__name__)


def load_prices_dataframe(sb: Client, symbol: str) -> pd.DataFrame:
    """Return OHLCV indexed by date for one symbol."""
    rows = fetch_all(
        sb,
        "prices_daily",
        "date, open, high, low, close, adj_close, volume, source",
        filters=lambda q: q.eq("symbol", symbol),
        order=("date", False),
    )
    if not rows:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])

    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").set_index("date")
    # Adjusted prices only for indicator math
    adj = df["adj_close"].where(df["adj_close"].notna(), df["close"])
    df["close"] = adj.astype(float)
    for col in ("open", "high", "low"):
        if col in df.columns:
            df[col] = df[col].astype(float)
    df["volume"] = df["volume"].fillna(0).astype(float)
    return df[["open", "high", "low", "close", "volume"]]
