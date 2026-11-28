"""Normalize LSE screener ``market_cap`` to USD (matches ``src/lib/marketCap.ts``)."""
from __future__ import annotations

MAX_SANE_MARKET_CAP_USD = 5e12


def normalize_market_cap_usd(raw: float | None, price: float | None = None) -> float | None:
    if raw is None:
        return None
    try:
        x = float(raw)
    except (TypeError, ValueError):
        return None
    if x <= 0:
        return None

    candidates: list[float] = []
    if x >= 1e9:
        candidates.append(x)
    if x >= 1e5:
        candidates.append(x * 1_000)
    if x >= 500:
        candidates.append(x * 1_000_000)
    candidates.append(x * 1_000_000)

    if price is not None and price > 0:
        best: float | None = None
        best_score = 1e9
        for usd in candidates:
            if usd <= 0 or usd > MAX_SANE_MARKET_CAP_USD:
                continue
            shares = usd / price
            if shares < 1e6 or shares > 25e9:
                continue
            score = abs(__import__("math").log10(shares) - 9.0)
            if score < best_score:
                best_score = score
                best = usd
        if best is not None:
            return best

    if x >= 1e9:
        return min(x, MAX_SANE_MARKET_CAP_USD) if x <= MAX_SANE_MARKET_CAP_USD else None
    if x >= 1e5:
        usd = x * 1_000
    elif x >= 500:
        usd = x * 1_000_000
    else:
        usd = x * 1_000_000
    return usd if 0 < usd <= MAX_SANE_MARKET_CAP_USD else None