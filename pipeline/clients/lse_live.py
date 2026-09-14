"""London Strategic Edge live tape — vault candles + websocket ticks.

Official client is ``lse-data`` (``from lse import LSE``). The old
PostgREST catalog at /iso is batch fundamentals, not a stream.
Live prints come from ``wss://data-ws.londonstrategicedge.com``.
Intraday history comes from ``https://api.londonstrategicedge.com/vault/candles``.

Do not write ticks into ``prices_daily``.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Iterable

VAULT_CANDLES = "https://api.londonstrategicedge.com/vault/candles"
WS_URL = "wss://data-ws.londonstrategicedge.com"
LIVE_TIMEFRAMES = ("1s", "5s", "15s", "30s", "1m", "3m", "5m", "15m", "30m", "1h", "4h")


def lse_api_key() -> str:
    return (os.getenv("LSE_API_KEY") or "").strip()


def lse_stream_configured() -> bool:
    return bool(lse_api_key())


def normalize_symbol(symbol: str) -> str:
    """Keep catalog form (AAPL, BRK.B, BTC/USD)."""
    return (symbol or "").strip().upper()


def tick_to_quote(tick: Any) -> dict | None:
    """Map an ``lse.Tick`` (or tick-shaped dict) to a ``quotes_last`` row."""
    if tick is None:
        return None
    if isinstance(tick, dict):
        symbol = tick.get("symbol")
        price = tick.get("price") or tick.get("last")
        bid = tick.get("bid")
        ask = tick.get("ask")
        volume = tick.get("volume")
        ts = tick.get("timestamp") or tick.get("ts")
        replay = bool(tick.get("replay"))
    else:
        symbol = getattr(tick, "symbol", None)
        price = getattr(tick, "price", None)
        bid = getattr(tick, "bid", None)
        ask = getattr(tick, "ask", None)
        volume = getattr(tick, "volume", None)
        ts = getattr(tick, "timestamp", None)
        replay = bool(getattr(tick, "replay", False))

    try:
        last = float(price)
    except (TypeError, ValueError):
        return None
    if not symbol or last <= 0 or not (last == last):
        return None

    parsed_ts = None
    if ts:
        try:
            parsed_ts = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        except ValueError:
            parsed_ts = None

    return {
        "symbol": normalize_symbol(str(symbol)),
        "last": last,
        "bid": float(bid) if bid is not None else None,
        "ask": float(ask) if ask is not None else None,
        "volume": float(volume) if volume is not None else None,
        "ts": (parsed_ts or datetime.now(timezone.utc)).isoformat(),
        "source": "lse_ws",
        "replay": replay,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def vault_candle_bar(row: dict) -> dict | None:
    """Normalize a vault candle row to the chart candle shape."""
    if not row:
        return None
    ts = row.get("timestamp") or row.get("ts") or row.get("t") or row.get("time")
    time_val: str | int | None
    if isinstance(ts, (int, float)) and ts > 1e9:
        time_val = int(ts if ts < 1e12 else ts / 1000)
    elif isinstance(ts, str) and len(ts) >= 10:
        raw = ts.strip()
        if len(raw) == 10 and raw[4] == "-":
            time_val = raw
        else:
            iso = raw.replace(" ", "T", 1)
            if not (iso.endswith("Z") or "+" in iso[10:] or iso.count("-") > 2):
                iso = iso + "Z"
            try:
                time_val = int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())
            except ValueError:
                return None
    else:
        return None
    try:
        o = float(row.get("open") if row.get("open") is not None else row.get("o"))
        h = float(row.get("high") if row.get("high") is not None else row.get("h"))
        low = float(row.get("low") if row.get("low") is not None else row.get("l"))
        c = float(row.get("close") if row.get("close") is not None else row.get("c"))
    except (TypeError, ValueError):
        return None
    if not all(x == x for x in (o, h, low, c)):
        return None
    high = max(h, o, c)
    lo = min(low, o, c)
    vol = row.get("volume") if row.get("volume") is not None else row.get("v")
    bar = {"time": time_val, "open": o, "high": high, "low": lo, "close": c}
    if vol is not None:
        try:
            bar["volume"] = float(vol)
        except (TypeError, ValueError):
            pass
    return bar


def make_client(api_key: str | None = None):
    from lse import LSE

    return LSE(api_key=api_key or lse_api_key())


def fetch_vault_candles(symbol: str, timeframe: str = "5m", limit: int = 400) -> list[dict]:
    """REST vault candles. Requires ``LSE_API_KEY``."""
    client = make_client()
    rows = client.candles(normalize_symbol(symbol), timeframe, limit=limit, order="desc")
    bars = [b for b in (vault_candle_bar(r) for r in rows) if b]
    bars.sort(key=lambda b: b["time"])
    return bars


def iter_ticks(symbols: Iterable[str], *, replay_start: str | None = None):
    """Blocking iterator of live ticks from the official LSE websocket."""
    client = make_client()
    names = [normalize_symbol(s) for s in symbols if s]
    if not names:
        return
    for tick in client.stream(names, reconnect=True, start=replay_start):
        yield tick
