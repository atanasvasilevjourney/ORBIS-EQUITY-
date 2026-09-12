"""Public cash-equity EOD bars — QMIE-shaped ingest, equity venues.

QMIE's live scanner pulls closed USDT-M klines (Binance / Bybit / OKX).
That venue is the wrong book for this terminal. The *pattern* we keep:

  • public REST, no API key
  • provider fallback
  • drop the in-progress session bar (closed-bar discipline)
  • ~300 daily bars so TEMA-199 can settle

Providers here are cash-market, in the order that works on a typical host:

  1. Yahoo chart API  (query1.finance.yahoo.com) — primary
  2. Stooq daily CSV  (stooq.com / stooq.pl)     — fallback when Yahoo fails

Do not vendor QMIE exchange clients. Do not fetch perps or funding.
"""
from __future__ import annotations

import csv
import io
import logging
import time
from dataclasses import dataclass
from datetime import date, datetime, time as dtime, timezone
from typing import Iterable
from zoneinfo import ZoneInfo

import requests

logger = logging.getLogger(__name__)

NY = ZoneInfo("America/New_York")
SESSION_CLOSE = dtime(16, 0)
YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
STOOQ_HOSTS = ("https://stooq.com/q/d/l/", "https://stooq.pl/q/d/l/")
YAHOO_UA = "Mozilla/5.0 (compatible; KovaViewCashEOD/1.0)"
DEFAULT_BARS = 300
REQUEST_TIMEOUT = 25
SLEEP_SEC = 0.12


@dataclass(frozen=True)
class DailyBar:
    symbol: str
    date: str
    open: float | None
    high: float | None
    low: float | None
    close: float | None
    adj_close: float | None
    volume: int | None
    source: str


def yahoo_ticker(symbol: str) -> str:
    """Yahoo uses hyphens for share-class dots (BRK.B → BRK-B)."""
    return symbol.strip().upper().replace(".", "-")


def stooq_candidates(symbol: str, country: str | None = None) -> list[str]:
    """Stooq daily codes to try, most-likely first."""
    raw = symbol.strip().lower().replace(".", "-")
    country = (country or "US").upper()
    if country in ("GB", "UK"):
        return [f"{raw}.uk", f"{raw}.us"]
    if country in ("DE", "GER"):
        return [f"{raw}.de", f"{raw}.us"]
    return [f"{raw}.us"]


def drop_in_progress(bars: list[DailyBar], *, now: datetime | None = None) -> list[DailyBar]:
    """Drop today's bar before the NYSE cash close (16:00 America/New_York).

    QMIE drops the unconfirmed kline so alerts match a closed bar. Same
    rule on the cash session: a print before 16:00 ET is not EOD.
    """
    if not bars:
        return bars
    now = now or datetime.now(NY)
    if now.tzinfo is None:
        now = now.replace(tzinfo=NY)
    else:
        now = now.astimezone(NY)
    last = bars[-1]
    try:
        last_d = date.fromisoformat(last.date)
    except ValueError:
        return bars
    if last_d == now.date() and now.time() < SESSION_CLOSE:
        return bars[:-1]
    return bars


def _f(v) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x != x:  # NaN
        return None
    return x


def _i(v) -> int | None:
    x = _f(v)
    if x is None:
        return None
    return int(x)


def _looks_like_csv(text: str) -> bool:
    head = (text or "").lstrip()[:80].lower()
    return head.startswith("date,") or head.startswith("date;")


def fetch_yahoo_daily(symbol: str, *, bars: int = DEFAULT_BARS) -> list[DailyBar]:
    """Daily OHLCV from Yahoo's public chart endpoint. ``range=max`` can
    downsample to monthly — request an explicit period instead.
    """
    ticker = yahoo_ticker(symbol)
    # ~1.6 calendar days per trading day, plus a week of slack
    lookback_days = max(40, int(bars * 1.7) + 10)
    period2 = int(time.time())
    period1 = period2 - lookback_days * 86400
    resp = requests.get(
        YAHOO_CHART.format(ticker=ticker),
        params={
            "period1": period1,
            "period2": period2,
            "interval": "1d",
            "events": "history",
            "includeAdjustedClose": "true",
        },
        headers={"User-Agent": YAHOO_UA},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    payload = resp.json()
    result = ((payload.get("chart") or {}).get("result") or [None])[0]
    if not result:
        raise RuntimeError(f"yahoo empty chart for {ticker}")
    ts = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    adj = (((result.get("indicators") or {}).get("adjclose") or [{}])[0] or {}).get("adjclose")
    opens, highs, lows, closes, vols = (
        quote.get("open") or [],
        quote.get("high") or [],
        quote.get("low") or [],
        quote.get("close") or [],
        quote.get("volume") or [],
    )
    out: list[DailyBar] = []
    for i, t in enumerate(ts):
        close = _f(closes[i] if i < len(closes) else None)
        if close is None:
            continue
        dt = datetime.fromtimestamp(int(t), tz=timezone.utc).astimezone(NY).date().isoformat()
        adj_c = _f(adj[i]) if adj is not None and i < len(adj) else close
        out.append(
            DailyBar(
                symbol=symbol.strip().upper(),
                date=dt,
                open=_f(opens[i] if i < len(opens) else None),
                high=_f(highs[i] if i < len(highs) else None),
                low=_f(lows[i] if i < len(lows) else None),
                close=close,
                adj_close=adj_c,
                volume=_i(vols[i] if i < len(vols) else None),
                source="yahoo",
            )
        )
    out.sort(key=lambda b: b.date)
    # de-dupe by date, last print wins
    by_date = {b.date: b for b in out}
    trimmed = [by_date[d] for d in sorted(by_date)]
    if bars and len(trimmed) > bars:
        trimmed = trimmed[-bars:]
    if len(trimmed) < 5:
        raise RuntimeError(f"yahoo daily too short for {ticker} ({len(trimmed)} bars)")
    return trimmed


def fetch_stooq_daily(symbol: str, *, country: str | None = None, bars: int = DEFAULT_BARS) -> list[DailyBar]:
    """Stooq daily CSV. Raises if every host/code returns HTML or empty."""
    last_err: Exception | None = None
    for code in stooq_candidates(symbol, country):
        for base in STOOQ_HOSTS:
            try:
                resp = requests.get(
                    base,
                    params={"s": code, "i": "d"},
                    headers={"User-Agent": YAHOO_UA},
                    timeout=REQUEST_TIMEOUT,
                )
                resp.raise_for_status()
                if not _looks_like_csv(resp.text):
                    last_err = RuntimeError(f"stooq HTML/challenge for {code}")
                    continue
                rows = list(csv.DictReader(io.StringIO(resp.text)))
                out: list[DailyBar] = []
                for row in rows:
                    close = _f(row.get("Close") or row.get("close"))
                    if close is None:
                        continue
                    raw_d = (row.get("Date") or row.get("date") or "")[:10]
                    if len(raw_d) < 10:
                        continue
                    out.append(
                        DailyBar(
                            symbol=symbol.strip().upper(),
                            date=raw_d,
                            open=_f(row.get("Open") or row.get("open")),
                            high=_f(row.get("High") or row.get("high")),
                            low=_f(row.get("Low") or row.get("low")),
                            close=close,
                            adj_close=close,
                            volume=_i(row.get("Volume") or row.get("volume")),
                            source="stooq",
                        )
                    )
                out.sort(key=lambda b: b.date)
                if bars and len(out) > bars:
                    out = out[-bars:]
                if len(out) >= 5:
                    return out
                last_err = RuntimeError(f"stooq too short for {code} ({len(out)} bars)")
            except Exception as exc:
                last_err = exc
                continue
    raise RuntimeError(f"stooq failed for {symbol}: {last_err}")


def fetch_daily_bars(
    symbol: str,
    *,
    country: str | None = None,
    bars: int = DEFAULT_BARS,
    now: datetime | None = None,
    sleep_s: float = 0.0,
) -> tuple[list[DailyBar], str]:
    """Yahoo first, Stooq fallback. Returns (closed bars, source)."""
    errors: list[str] = []
    for fetcher, name in (
        (lambda: fetch_yahoo_daily(symbol, bars=bars), "yahoo"),
        (lambda: fetch_stooq_daily(symbol, country=country, bars=bars), "stooq"),
    ):
        try:
            raw = fetcher()
            closed = drop_in_progress(raw, now=now)
            if len(closed) < 5:
                errors.append(f"{name}: only {len(closed)} closed bars")
                continue
            if sleep_s:
                time.sleep(sleep_s)
            return closed, closed[-1].source
        except Exception as exc:
            errors.append(f"{name}: {exc}")
            continue
    raise RuntimeError(f"{symbol} cash EOD failed ({'; '.join(errors)})")


def bars_to_rows(bars: Iterable[DailyBar]) -> list[dict]:
    """Shape rows for ``prices_daily`` upsert."""
    rows = []
    for b in bars:
        if not b.symbol or not b.date or b.close is None:
            continue
        rows.append(
            {
                "symbol": b.symbol,
                "date": b.date,
                "open": b.open,
                "high": b.high,
                "low": b.low,
                "close": b.close,
                "adj_close": b.adj_close,
                "volume": b.volume,
                "source": b.source,
            }
        )
    return rows
