"""Yahoo chart intraday bars (5m default) — matches terminal chart API."""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import pandas as pd
import requests

NY = "America/New_York"
YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
UA = "Mozilla/5.0 (compatible; OrbisEquity-EMA200/1.0)"


@dataclass(frozen=True)
class IntradayFetchMeta:
    symbol: str
    interval: str
    range_param: str
    fetch_ms: float
    n_bars: int
    duplicate_ts: int


def fetch_yahoo_intraday(
    symbol: str,
    *,
    interval: str = "5m",
    range_param: str = "5d",
    timeout: float = 25.0,
) -> tuple[pd.DataFrame, IntradayFetchMeta]:
    """Return OHLCV indexed by America/New_York datetime."""
    t0 = time.perf_counter()
    url = YAHOO_CHART.format(ticker=symbol.upper())
    resp = requests.get(
        url,
        params={
            "interval": interval,
            "range": range_param,
            "includePrePost": "false",
            "events": "history",
        },
        headers={"User-Agent": UA},
        timeout=timeout,
    )
    resp.raise_for_status()
    result = ((resp.json().get("chart") or {}).get("result") or [None])[0]
    if not result:
        raise RuntimeError(f"empty yahoo chart for {symbol}")
    ts = result.get("timestamp") or []
    q = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    rows: list[dict[str, Any]] = []
    last_ts = -1
    dup = 0
    for i, t in enumerate(ts):
        if t <= last_ts:
            dup += 1
            continue
        last_ts = int(t)
        c = _f(q.get("close", [None])[i] if i < len(q.get("close") or []) else None)
        if c is None:
            continue
        o = _f(q.get("open", [None])[i] if i < len(q.get("open") or []) else None) or c
        h = _f(q.get("high", [None])[i] if i < len(q.get("high") or []) else None) or c
        l = _f(q.get("low", [None])[i] if i < len(q.get("low") or []) else None) or c
        vol = _f(q.get("volume", [None])[i] if i < len(q.get("volume") or []) else None) or 0.0
        rows.append({"ts": last_ts, "open": o, "high": h, "low": l, "close": c, "volume": vol})
    if not rows:
        meta = IntradayFetchMeta(symbol.upper(), interval, range_param, (time.perf_counter() - t0) * 1000, 0, dup)
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"]), meta
    df = pd.DataFrame(rows)
    df["datetime"] = pd.to_datetime(df["ts"], unit="s", utc=True).dt.tz_convert(NY)
    df = df.set_index("datetime").sort_index()[["open", "high", "low", "close", "volume"]]
    meta = IntradayFetchMeta(
        symbol.upper(),
        interval,
        range_param,
        (time.perf_counter() - t0) * 1000,
        len(df),
        dup,
    )
    return df, meta


def last_bar_age_minutes(bars: pd.DataFrame) -> float | None:
    if bars.empty:
        return None
    last = bars.index[-1]
    if last.tzinfo is None:
        last = last.tz_localize(NY)
    delta = datetime.now(timezone.utc) - last.tz_convert(timezone.utc)
    return delta.total_seconds() / 60.0


def _f(v) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x != x:
        return None
    return x
