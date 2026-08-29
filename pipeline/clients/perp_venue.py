"""Best-effort public marks/funding for USDT-M linear perps.

Binance fapi and Bybit are often geo-blocked from this environment.
The desk still prices from listed-equity EOD; venue fields stay null
and `venue` is `synthetic`. No API keys. No orders.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)

TIMEOUT = 6.0
HEADERS = {"User-Agent": "KovaView-perps-desk/1.0"}


def _get(url: str, timeout: float = TIMEOUT) -> dict | list | None:
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        if "CloudFront" in raw or "restricted location" in raw or "not available" in raw[:200].lower():
            return None
        return json.loads(raw)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
        logger.info("perp venue miss %s: %s", url.split("?")[0], exc)
        return None


def _bybit(symbols: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    payload = _get("https://api.bybit.com/v5/market/tickers?category=linear")
    if not isinstance(payload, dict):
        return out
    rows = (payload.get("result") or {}).get("list") or []
    want = {s.upper() for s in symbols}
    for row in rows:
        sym = str(row.get("symbol") or "").upper()
        if sym not in want:
            continue
        mark = row.get("markPrice") or row.get("lastPrice")
        funding = row.get("fundingRate")
        try:
            out[sym] = {
                "venue": "bybit",
                "mark": float(mark) if mark not in (None, "") else None,
                "funding_8h": float(funding) if funding not in (None, "") else None,
            }
        except (TypeError, ValueError):
            continue
    return out


def _binance(symbols: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    payload = _get("https://fapi.binance.com/fapi/v1/premiumIndex")
    if not isinstance(payload, list):
        return out
    want = {s.upper() for s in symbols}
    for row in payload:
        if not isinstance(row, dict):
            continue
        sym = str(row.get("symbol") or "").upper()
        if sym not in want:
            continue
        mark = row.get("markPrice")
        funding = row.get("lastFundingRate")
        try:
            out[sym] = {
                "venue": "binance",
                "mark": float(mark) if mark not in (None, "") else None,
                "funding_8h": float(funding) if funding not in (None, "") else None,
            }
        except (TypeError, ValueError):
            continue
    return out


def fetch_venue_tape(perp_symbols: list[str]) -> dict[str, dict]:
    """Return {PERP: {venue, mark, funding_8h}} for listed contracts only."""
    if not perp_symbols:
        return {}
    tape = _bybit(perp_symbols)
    missing = [s for s in perp_symbols if s.upper() not in tape]
    if missing:
        tape.update(_binance(missing))
    return tape
