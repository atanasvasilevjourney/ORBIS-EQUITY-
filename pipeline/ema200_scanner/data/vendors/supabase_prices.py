"""Load OHLCV history from ``prices_daily`` (adjusted close when present)."""
from __future__ import annotations

import logging

import pandas as pd
from supabase import Client

from pipeline.ema200_scanner.data.adjust import scale_ohlcv_frame
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
    # One scale for close, high, and low — ribbon and ATR both need it.
    df = scale_ohlcv_frame(df)
    return df[["open", "high", "low", "close", "volume"]]
