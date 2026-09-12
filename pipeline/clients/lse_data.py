"""London Strategic Edge market-data client (lse-data SDK).

This is the *live/candles* product (`lse_live_…` keys), distinct from the
PostgREST screener at api.londonstrategicedge.com.
"""
from __future__ import annotations

import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterator

logger = logging.getLogger(__name__)


def lse_api_key() -> str:
    return (
        os.getenv("LSE_API_KEY", "").strip()
        or os.getenv("LSE_DATA_API_KEY", "").strip()
    )


def has_lse_data_key() -> bool:
    return bool(lse_api_key())


def get_lse_data_client():
    """Return an authenticated ``lse.LSE`` client or raise RuntimeError."""
    key = lse_api_key()
    if not key:
        raise RuntimeError(
            "LSE_API_KEY is required for London Strategic Edge candles/stream "
            "(use an lse_live_… key from londonstrategicedge.com/data)."
        )
    try:
        from lse import LSE
    except ImportError as exc:
        raise RuntimeError("lse-data is not installed — pip install 'lse-data>=0.14'") from exc
    return LSE(api_key=key)


def candle_to_price_row(candle: dict[str, Any], *, source: str = "lse") -> dict[str, Any] | None:
    """Map an LSE candle dict onto a ``prices_daily`` upsert row."""
    symbol = candle.get("symbol")
    ts = candle.get("timestamp") or candle.get("date") or candle.get("t")
    if not symbol or not ts:
        return None
    date_str = str(ts)[:10]
    try:
        close = candle.get("close")
        if close is None:
            return None
        close_f = float(close)
    except (TypeError, ValueError):
        return None

    def _num(key: str):
        val = candle.get(key)
        if val is None:
            return None
        try:
            return float(val)
        except (TypeError, ValueError):
            return None

    vol = candle.get("volume")
    try:
        vol_i = int(vol) if vol is not None else None
    except (TypeError, ValueError):
        vol_i = None

    return {
        "symbol": str(symbol).upper(),
        "date": date_str,
        "open": _num("open"),
        "high": _num("high"),
        "low": _num("low"),
        "close": close_f,
        "volume": vol_i,
        "source": source,
    }


def fetch_daily_candles(
    symbols: list[str],
    *,
    lookback_days: int = 14,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Fetch recent daily OHLCV for symbols via the lse-data SDK."""
    if not symbols:
        return []
    client = get_lse_data_client()
    start = (datetime.now(timezone.utc).date() - timedelta(days=lookback_days)).isoformat()
    rows: list[dict[str, Any]] = []
    ok = fail = 0

    for idx, symbol in enumerate(symbols, 1):
        try:
            candles = client.candles(
                symbol,
                "1d",
                start=start,
                limit=limit,
                order="desc",
            )
            mapped = 0
            for c in candles or []:
                if "symbol" not in c:
                    c = {**c, "symbol": symbol}
                row = candle_to_price_row(c, source="lse")
                if row:
                    rows.append(row)
                    mapped += 1
            if mapped:
                ok += 1
            else:
                fail += 1
                logger.debug("No usable LSE candles for %s", symbol)
        except Exception:
            fail += 1
            logger.warning("LSE candle fetch failed for %s", symbol, exc_info=True)

        if idx % 50 == 0:
            logger.info("LSE candles: %d/%d (%d ok, %d fail)", idx, len(symbols), ok, fail)

    logger.info(
        "LSE candles complete: %d/%d symbols, %d rows",
        ok,
        len(symbols),
        len(rows),
    )
    return rows


def stream_ticks(
    symbols: list[str],
    *,
    reconnect: bool = True,
) -> Iterator[Any]:
    """Yield live ``Tick`` objects for ``symbols``."""
    client = get_lse_data_client()
    logger.info("LSE live stream starting for %d symbols", len(symbols))
    yield from client.stream(symbols, reconnect=reconnect)
