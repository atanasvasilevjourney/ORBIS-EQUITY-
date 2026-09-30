"""Download 5m bars (Yahoo) for Zarattini ORB validation."""

from __future__ import annotations

import time
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf

NY = ZoneInfo("America/New_York")


def yfinance_5m_to_orb_df(raw: pd.DataFrame) -> pd.DataFrame:
    """Normalize yfinance 5m OHLCV to Zarattini `date` column in naive ET."""
    if raw is None or raw.empty:
        return pd.DataFrame(columns=["date", "open", "high", "low", "close", "volume"])
    df = raw.copy()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[0] for c in df.columns]
    df.columns = [str(c).lower() for c in df.columns]
    if not isinstance(df.index, pd.DatetimeIndex):
        raise ValueError("expected DatetimeIndex from yfinance")
    idx = df.index
    if idx.tz is None:
        idx = idx.tz_localize("UTC")
    idx = idx.tz_convert(NY).tz_localize(None)
    out = pd.DataFrame(
        {
            "date": idx,
            "open": df["open"].astype(float),
            "high": df["high"].astype(float),
            "low": df["low"].astype(float),
            "close": df["close"].astype(float),
            "volume": df.get("volume"),
        }
    )
    out = out.dropna(subset=["open", "high", "low", "close"])
    return out.sort_values("date").reset_index(drop=True)


def fetch_5m(symbol: str, period: str = "60d", pause_s: float = 0.35) -> pd.DataFrame:
    time.sleep(pause_s)
    raw = yf.download(
        symbol,
        period=period,
        interval="5m",
        auto_adjust=False,
        progress=False,
        threads=False,
    )
    return yfinance_5m_to_orb_df(raw)


def orb_universe_symbols() -> list[str]:
    """Orbis ORB liquid sleeve + QQQ benchmark (same list as nightly ORB scan seed)."""
    from pipeline.compute.opening_range import LIQUID

    syms = sorted(set(LIQUID) | {"QQQ"})
    return syms
