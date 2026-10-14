"""Watchlist filter — names near / holding the 200 EMA after an uptrend (discretionary scan)."""
from __future__ import annotations

from typing import Any

from pipeline.ema200_scanner.config.loader import load_config


def watchlist_thresholds(cfg: dict[str, Any] | None = None) -> dict[str, float | int | bool]:
    cfg = cfg or load_config()
    touch = cfg.get("touch", {})
    trend = cfg.get("trend", {})
    wl = cfg.get("watchlist", {})
    return {
        "shortlist_atr": float(touch.get("shortlist_atr", 1.5)),
        "min_days_above": int(wl.get("min_days_above", trend.get("min_days_above", 20))),
        "min_slope": float(wl.get("min_slope", trend.get("min_slope", 0.0))),
        "require_close_above_ema": bool(wl.get("require_close_above_ema", True)),
        "require_uptrend": bool(wl.get("require_uptrend", True)),
    }


def _watchlist_dist_atr(row: dict[str, Any]) -> float | None:
    """Proximity to the double EMA ribbon (close + high 200 EMA); falls back to close dist."""
    raw = row.get("ribbon_dist_atr")
    if raw is None:
        raw = row.get("dist_atr")
    if raw is None:
        return None
    try:
        return abs(float(raw))
    except (TypeError, ValueError):
        return None


def classify_setup(row: dict[str, Any], *, cfg: dict[str, Any] | None = None) -> str | None:
    """Return setup label if row belongs on the discretionary watchlist, else None."""
    th = watchlist_thresholds(cfg)
    dist_f = _watchlist_dist_atr(row)
    if dist_f is None:
        return None
    if dist_f > float(th["shortlist_atr"]):
        return None

    close = row.get("close")
    ema = row.get("ema200")
    if close is None or ema is None:
        return None
    close_f = float(close)
    ema_f = float(ema)
    held = close_f >= ema_f

    days_above = int(row.get("days_above") or 0)
    slope = float(row.get("ema200_slope") or 0)
    uptrend = days_above >= int(th["min_days_above"]) and slope > float(th["min_slope"])

    if th["require_uptrend"] and not uptrend:
        return None
    if th["require_close_above_ema"] and not held:
        return None

    if held and uptrend:
        return "RETRACE_HELD"
    if held:
        return "AT_EMA_HELD"
    return "NEAR_EMA"


def row_for_display(row: dict[str, Any], setup: str) -> dict[str, Any]:
    sym = row.get("symbol", "")
    tv = sym.replace("-", "") if sym else ""
    return {
        "symbol": sym,
        "bar_date": row.get("bar_date"),
        "setup": setup,
        "close": row.get("close"),
        "ema200": row.get("ema200"),
        "ema200_high": row.get("ema200_high"),
        "dist_atr": row.get("dist_atr"),
        "ribbon_dist_atr": row.get("ribbon_dist_atr"),
        "days_above": row.get("days_above"),
        "ema200_slope": row.get("ema200_slope"),
        "rvol": row.get("rvol"),
        "regime": row.get("regime"),
        "tradingview_url": f"https://www.tradingview.com/chart/?symbol={tv}",
    }
