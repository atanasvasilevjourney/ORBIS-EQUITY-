"""Crypto daily candles via ccxt (UTC midnight close bucket)."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import pandas as pd

logger = logging.getLogger(__name__)


def fetch_crypto_ohlcv(
    pair: str,
    *,
    exchange_id: str = "binance",
    limit: int = 600,
) -> pd.DataFrame:
    """Fetch daily OHLCV; ``close`` is the candle close (ccxt 1d UTC)."""
    try:
        import ccxt  # type: ignore
    except ImportError as err:
        raise RuntimeError("ccxt is required for crypto ingest — pip install ccxt") from err

    exchange_cls = getattr(ccxt, exchange_id, None)
    if exchange_cls is None:
        raise ValueError(f"Unknown ccxt exchange: {exchange_id}")

    exchange = exchange_cls({"enableRateLimit": True, "timeout": 30_000})
    try:
        raw = exchange.fetch_ohlcv(pair, timeframe="1d", limit=limit)
    finally:
        exchange.close()

    if not raw:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])

    df = pd.DataFrame(raw, columns=["ts", "open", "high", "low", "close", "volume"])
    df["date"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
    df = df.sort_values("date").set_index("date")
    for col in ("open", "high", "low", "close", "volume"):
        df[col] = df[col].astype(float)
    return df[["open", "high", "low", "close", "volume"]]


def top_crypto_pairs(*, top_n: int) -> list[str]:
    """Static fallback list when live market discovery is unavailable."""
    base = [
        "BTC/USDT",
        "ETH/USDT",
        "BNB/USDT",
        "SOL/USDT",
        "XRP/USDT",
        "ADA/USDT",
        "DOGE/USDT",
        "AVAX/USDT",
        "DOT/USDT",
        "LINK/USDT",
    ]
    return base[:top_n]
