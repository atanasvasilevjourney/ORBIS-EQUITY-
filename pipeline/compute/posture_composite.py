"""Composite market posture (0–100) from breadth, trend, indices, 52w range, and risk."""
from __future__ import annotations

import json
import logging
import math
import os
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from pipeline.ema200_scanner.indicators.ema import ema_series

logger = logging.getLogger(__name__)

_CONFIG_PATH = Path(__file__).resolve().parents[2] / "shared" / "posture_composite.json"


def load_posture_config() -> dict[str, Any]:
    with _CONFIG_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


def posture_label(score: int, *, risk_off: bool = False) -> str:
    cfg = load_posture_config()
    if risk_off:
        score = min(score, int(cfg.get("risk_off_cap_score", 54)))
    for band in cfg.get("labels", []):
        if score >= int(band["min"]):
            return str(band["name"])
    return "Bearish"


def _clip_score(x: float) -> int:
    if not math.isfinite(x):
        return 50
    return int(min(100, max(0, round(x))))


def _sma(series: pd.Series, period: int) -> float | None:
    if len(series) < period:
        return None
    return float(series.tail(period).mean())


def _slope_20(close: pd.Series) -> float | None:
    if len(close) < 21:
        return None
    tail = close.tail(21).astype(float)
    return float((tail.iloc[-1] / tail.iloc[0] - 1.0) * 100.0)


def index_trend_score(close: pd.Series) -> int:
    """SPY/QQQ: price vs 20/50 SMA and 20-day slope → 0–100."""
    if len(close) < 50:
        return 50
    price = float(close.iloc[-1])
    sma20 = _sma(close, 20)
    sma50 = _sma(close, 50)
    slope = _slope_20(close)
    if sma20 is None or sma50 is None:
        return 50
    above20 = 25 if price >= sma20 else 0
    above50 = 25 if price >= sma50 else 0
    slope_pts = 25 if (slope or 0) > 0.5 else (12 if (slope or 0) > -0.5 else 0)
    spread = 25 if sma20 >= sma50 else 10
    return _clip_score(above20 + above50 + slope_pts + spread)


def breadth_pillar(advancers_pct: float, ad_trend_5d: float) -> int:
    """~60% day advancers + ~40% five-session advance/decline momentum."""
    return _clip_score(0.6 * advancers_pct + 0.4 * ad_trend_5d)


def trend_pillar(pct_above_50: float, pct_above_200: float) -> int:
    return _clip_score(0.5 * pct_above_50 + 0.5 * pct_above_200)


def highs_lows_pillar(pct_new_highs: float, pct_new_lows: float) -> int:
    """Net new highs minus new lows as share of universe (mapped to 0–100)."""
    net = pct_new_highs - pct_new_lows  # roughly -100 .. +100
    return _clip_score(50.0 + net * 0.5)


def vix_level_score(vix: float | None) -> int:
    cfg = load_posture_config().get("vix", {})
    low = float(cfg.get("low_threshold", 16))
    high = float(cfg.get("high_threshold", 25))
    if vix is None or not math.isfinite(vix):
        return 50
    if vix <= low:
        return _clip_score(100 - (vix / low) * 20)
    if vix >= high:
        return _clip_score(30 - min(30, (vix - high) * 2))
    # linear between low and high
    frac = (vix - low) / max(0.01, high - low)
    return _clip_score(80 - frac * 50)


def risk_pillar(vix: float | None, vix3m: float | None, gex_sign: int | None) -> tuple[int, bool]:
    """Risk regime pillar; returns (score, risk_off flag)."""
    base = vix_level_score(vix)
    if vix is not None and vix3m is not None and math.isfinite(vix) and math.isfinite(vix3m):
        if vix > vix3m * 1.02:
            base -= 15
        elif vix < vix3m * 0.98:
            base += 5
    if gex_sign is not None:
        base += 8 if gex_sign > 0 else (-8 if gex_sign < 0 else 0)
    score = _clip_score(base)
    risk_off = score < 40 or (vix is not None and vix > float(load_posture_config()["vix"]["high_threshold"]))
    return score, risk_off


def composite_score(pillars: dict[str, int], weights: dict[str, float] | None = None) -> int:
    cfg = load_posture_config()
    w = weights or cfg["weights"]
    total = 0.0
    for key, wt in w.items():
        total += float(pillars.get(key, 50)) * float(wt)
    return _clip_score(total)


def ema_trend_stats(
    prices_by_symbol: dict[str, pd.DataFrame],
    symbols: list[str],
) -> tuple[float, float, float, float]:
    """Returns advancers%, pct_above_50, pct_above_200, ad_trend_5d proxy."""
    above50 = 0
    above200 = 0
    adv_today = 0
    ad_streak: list[float] = []
    counted = 0

    for sym in symbols:
        df = prices_by_symbol.get(sym)
        if df is None or len(df) < 200:
            continue
        close = df["close"].astype(float)
        ema50 = ema_series(close, 50)
        ema200 = ema_series(close, 200)
        last = float(close.iloc[-1])
        e50 = float(ema50.iloc[-1]) if np.isfinite(ema50.iloc[-1]) else None
        e200 = float(ema200.iloc[-1]) if np.isfinite(ema200.iloc[-1]) else None
        if e50 is not None and last >= e50:
            above50 += 1
        if e200 is not None and last >= e200:
            above200 += 1
        if len(close) >= 2:
            chg = (last / float(close.iloc[-2]) - 1.0) * 100.0
            if chg > 0:
                adv_today += 1
        if len(close) >= 6:
            ups = sum(
                1
                for i in range(-5, 0)
                if float(close.iloc[i]) > float(close.iloc[i - 1])
            )
            ad_streak.append(ups / 5.0 * 100.0)
        counted += 1

    if counted == 0:
        return 0.0, 50.0, 50.0, 50.0
    adv_pct = adv_today / counted * 100.0
    pct50 = above50 / counted * 100.0
    pct200 = above200 / counted * 100.0
    ad5 = sum(ad_streak) / len(ad_streak) if ad_streak else adv_pct
    return adv_pct, pct50, pct200, ad5


def highs_lows_stats(prices_by_symbol: dict[str, pd.DataFrame], symbols: list[str]) -> tuple[float, float]:
    nh = nl = counted = 0
    for sym in symbols:
        df = prices_by_symbol.get(sym)
        if df is None or len(df) < 252:
            continue
        close = df["close"].astype(float)
        last = float(close.iloc[-1])
        hi52 = float(close.tail(252).max())
        lo52 = float(close.tail(252).min())
        if last >= hi52 * 0.998:
            nh += 1
        if last <= lo52 * 1.002:
            nl += 1
        counted += 1
    if counted == 0:
        return 0.0, 0.0
    return nh / counted * 100.0, nl / counted * 100.0


def fetch_gex_sign() -> int | None:
    """Optional ORBIS GEX sign (+1 / -1). Degrades to None when unavailable."""
    url = (os.getenv("ORBIS_GEX_API_URL") or "").strip()
    if not url:
        return None
    try:
        import urllib.request

        with urllib.request.urlopen(url, timeout=4) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        if isinstance(payload, dict):
            sign = payload.get("gex_sign") or payload.get("sign")
            if sign is not None:
                return 1 if float(sign) > 0 else (-1 if float(sign) < 0 else 0)
    except Exception:
        logger.info("GEX feed unavailable; risk pillar uses VIX only", exc_info=True)
    return None


def build_price_frames(rows: list[dict]) -> dict[str, pd.DataFrame]:
    if not rows:
        return {}
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    out: dict[str, pd.DataFrame] = {}
    for sym, grp in df.groupby("symbol"):
        out[str(sym)] = grp.sort_values("date").reset_index(drop=True)
    return out


def compute_posture_bundle(
    *,
    universe_symbols: list[str],
    price_rows: list[dict],
    index_frames: dict[str, pd.DataFrame],
    advancers_pct: float | None = None,
    gex_sign: int | None = None,
) -> dict[str, Any]:
    """Full composite posture for storage / API."""
    frames = build_price_frames(price_rows)
    adv, pct50, pct200, ad5 = ema_trend_stats(frames, universe_symbols)
    adv_pct = float(advancers_pct if advancers_pct is not None else adv)
    nh, nl = highs_lows_stats(frames, universe_symbols)

    spy = index_frames.get("SPY")
    qqq = index_frames.get("QQQ")
    idx_scores = []
    if spy is not None and len(spy):
        idx_scores.append(index_trend_score(spy["close"].astype(float)))
    if qqq is not None and len(qqq):
        idx_scores.append(index_trend_score(qqq["close"].astype(float)))
    index_score = int(round(sum(idx_scores) / len(idx_scores))) if idx_scores else 50

    vix_frame = index_frames.get("VIX") or index_frames.get("^VIX")
    vix3m_frame = index_frames.get("VIX3M") or index_frames.get("^VIX3M")
    vix = float(vix_frame["close"].iloc[-1]) if vix_frame is not None and len(vix_frame) else None
    vix3m = float(vix3m_frame["close"].iloc[-1]) if vix3m_frame is not None and len(vix3m_frame) else None
    if vix is None and spy is not None and len(spy) >= 30:
        ret = spy["close"].astype(float).pct_change().tail(20).std() * np.sqrt(252) * 100
        vix = float(ret) if np.isfinite(ret) else None

    risk_score, risk_off = risk_pillar(vix, vix3m, gex_sign)

    pillars = {
        "breadth": breadth_pillar(adv_pct, ad5),
        "trend": trend_pillar(pct50, pct200),
        "index_trend": index_score,
        "highs_lows": highs_lows_pillar(nh, nl),
        "risk": risk_score,
    }
    score = composite_score(pillars)
    label = posture_label(score, risk_off=risk_off)
    if risk_off and score > int(load_posture_config().get("risk_off_cap_score", 54)):
        score = int(load_posture_config().get("risk_off_cap_score", 54))
        label = "Neutral"

    return {
        "posture_score": score,
        "posture_label": label,
        "posture_basis": "composite",
        "risk_off": risk_off,
        "posture_pillars": {
            **pillars,
            "participation": None,
            "leadership": None,
            "vol": risk_score,
            "guidance": _guidance(pillars, risk_off),
        },
        "diagnostics": {
            "advancers_pct": round(adv_pct, 1),
            "pct_above_ema50": round(pct50, 1),
            "pct_above_ema200": round(pct200, 1),
            "ad_trend_5d": round(ad5, 1),
            "pct_new_highs": round(nh, 1),
            "pct_new_lows": round(nl, 1),
            "vix": round(vix, 2) if vix is not None else None,
        },
    }


def _guidance(pillars: dict[str, int], risk_off: bool) -> str:
    if risk_off:
        return "Risk-off regime — cap exposure; favor quality and hedges"
    b, t = pillars.get("breadth", 50), pillars.get("trend", 50)
    if b >= 60 and t >= 55:
        return "Broad participation with positive trend — stay selective"
    if b <= 40:
        return "Weak breadth — reduce heat, wait for repair"
    return "Mixed composite — size to posture and sector leaders"