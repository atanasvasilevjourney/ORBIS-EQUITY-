"""Triangle pattern detection — ascending breakout (pillai-style) + descending break-up.

Ported conceptually from pillai-amal/Ascending_Triangle_Breakout_using_Python:
flat swing highs + rising lows for ascending; mirror for descending (flat lows + falling highs).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
import pandas as pd

PatternType = Literal["ascending", "descending"]
PatternStatus = Literal["forming", "breakout_up", "breakout_down"]


@dataclass(frozen=True)
class TriangleConfig:
    lookback_bars: int = 80
    swing_order: int = 3
    min_swing_points: int = 2
    flat_tolerance_pct: float = 1.8
    min_slope_pct_per_bar: float = 0.02
    max_slope_pct_per_bar: float = 2.5
    breakout_buffer_pct: float = 0.15


def _cfg_from_dict(d: dict) -> TriangleConfig:
    return TriangleConfig(
        lookback_bars=int(d.get("lookback_bars", 80)),
        swing_order=int(d.get("swing_order", 3)),
        min_swing_points=int(d.get("min_swing_points", 2)),
        flat_tolerance_pct=float(d.get("flat_tolerance_pct", 1.8)),
        min_slope_pct_per_bar=float(d.get("min_slope_pct_per_bar", 0.02)),
        max_slope_pct_per_bar=float(d.get("max_slope_pct_per_bar", 2.5)),
        breakout_buffer_pct=float(d.get("breakout_buffer_pct", 0.15)),
    )


def swing_points(series: pd.Series, order: int, kind: Literal["high", "low"]) -> list[tuple[int, float]]:
    vals = series.astype(float).to_numpy()
    n = len(vals)
    out: list[tuple[int, float]] = []
    if n < order * 2 + 1:
        return out
    for i in range(order, n - order):
        window = vals[i - order : i + order + 1]
        v = vals[i]
        if kind == "high" and v == np.nanmax(window) and v > np.nanmin(window):
            out.append((i, float(v)))
        elif kind == "low" and v == np.nanmin(window) and v < np.nanmax(window):
            out.append((i, float(v)))
    return out


def _flat_enough(values: list[float], tol_pct: float) -> bool:
    if len(values) < 2:
        return False
    avg = float(np.mean(values))
    if avg <= 0:
        return False
    spread_pct = (max(values) - min(values)) / avg * 100.0
    return spread_pct <= tol_pct


def _slope_pct_per_bar(indices: list[int], values: list[float]) -> float | None:
    if len(indices) < 2:
        return None
    x = np.array(indices, dtype=float)
    y = np.array(values, dtype=float)
    slope = float(np.polyfit(x, y, 1)[0])
    mid = float(np.mean(y))
    if mid <= 0:
        return None
    return slope / mid * 100.0


def _line_value(i0: int, p0: float, i1: int, p1: float, at: int) -> float:
    if i1 == i0:
        return p0
    slope = (p1 - p0) / (i1 - i0)
    return p0 + slope * (at - i0)


def _geometry(
    dates: list[str],
    support_price: float,
    res_i0: int,
    res_p0: float,
    res_i1: int,
    res_p1: float,
    window_start: int,
    window_end: int,
) -> dict[str, Any]:
    t0 = dates[window_start]
    t1 = dates[window_end]
    rt0 = dates[res_i0]
    rt1 = dates[res_i1]
    return {
        "window": {"from": t0, "to": t1},
        "support": {"from": t0, "to": t1, "price": round(support_price, 4)},
        "resistance": {
            "from": {"time": rt0, "price": round(res_p0, 4)},
            "to": {"time": rt1, "price": round(res_p1, 4)},
        },
    }


def detect_triangle(
    df: pd.DataFrame,
    pattern: PatternType,
    cfg: TriangleConfig | dict | None = None,
) -> dict[str, Any] | None:
    """Return latest triangle snapshot on the last bar, or None."""
    c = _cfg_from_dict(cfg) if isinstance(cfg, dict) else (cfg or TriangleConfig())
    if df is None or df.empty:
        return None
    d = df.copy()
    if "date" in d.columns:
        d = d.sort_values("date")
        dates = [str(x)[:10] for x in d["date"].tolist()]
    else:
        d = d.sort_index()
        dates = [str(x)[:10] for x in d.index.tolist()]
    if len(d) < c.lookback_bars:
        return None

    window = d.iloc[-c.lookback_bars :].reset_index(drop=True)
    dates_w = dates[-c.lookback_bars :]
    high = window["high"].astype(float)
    low = window["low"].astype(float)
    close = window["close"].astype(float)
    n = len(window)
    last_i = n - 1
    last_close = float(close.iloc[-1])
    prev_close = float(close.iloc[-2]) if n > 1 else last_close

    sh = swing_points(high, c.swing_order, "high")
    sl = swing_points(low, c.swing_order, "low")
    if len(sh) < c.min_swing_points or len(sl) < c.min_swing_points:
        return None

    if pattern == "ascending":
        max_hi = max(p for _, p in sh)
        tol = c.flat_tolerance_pct / 100.0
        highs = [(i, p) for i, p in sh if p >= max_hi * (1.0 - tol)]
        if len(highs) < c.min_swing_points:
            return None
        highs = highs[-c.min_swing_points :]
        if not _flat_enough([p for _, p in highs], c.flat_tolerance_pct):
            return None
        lo_min = float(low.min())
        lo_span = float(low.max() - lo_min)
        lo_cut = lo_min + lo_span * 0.35 if lo_span > 0 else lo_min
        sig_lows = [(i, p) for i, p in sl if p >= lo_cut]
        if len(sig_lows) < c.min_swing_points:
            return None
        slope = _slope_pct_per_bar([i for i, _ in sig_lows], [p for _, p in sig_lows])
        if slope is None or slope < c.min_slope_pct_per_bar or slope > c.max_slope_pct_per_bar:
            return None
        resistance = float(np.mean([p for _, p in highs]))
        sup_pts = sig_lows[-c.min_swing_points :]
        support = float(np.mean([p for _, p in sup_pts]))
        res_i0, res_p0 = highs[0]
        res_i1, res_p1 = highs[-1]
        sup_i0, sup_p0 = sup_pts[0]
        sup_i1, sup_p1 = sup_pts[-1]
        buffer = resistance * c.breakout_buffer_pct / 100.0
        status: PatternStatus = "forming"
        if last_close > resistance + buffer and prev_close <= resistance + buffer:
            status = "breakout_up"
        elif last_close < support and prev_close >= support:
            status = "breakout_down"
        score = min(100.0, 40.0 + slope * 8.0 + len(highs) * 5.0)
        geom = _geometry(dates_w, support, res_i0, res_p0, res_i1, res_p1, 0, last_i)
        geom["support"]["from"] = dates_w[sup_i0]
        geom["support"]["to"] = dates_w[sup_i1]
        geom["support"]["price_start"] = round(sup_p0, 4)
        geom["support"]["price_end"] = round(sup_p1, 4)
        return {
            "pattern_type": "ascending",
            "status": status,
            "score": round(score, 2),
            "resistance_price": round(resistance, 4),
            "support_price": round(support, 4),
            "resistance_slope_pct_per_bar": 0.0,
            "support_slope_pct_per_bar": round(slope, 4),
            "geometry": geom,
            "close": round(last_close, 4),
        }

    # descending — flat support, falling highs; bullish break-up above descending resistance
    min_lo = min(p for _, p in sl)
    tol = c.flat_tolerance_pct / 100.0
    lows_pts = [(i, p) for i, p in sl if p <= min_lo * (1.0 + tol)]
    if len(lows_pts) < c.min_swing_points:
        return None
    lows_pts = lows_pts[-c.min_swing_points :]
    if not _flat_enough([p for _, p in lows_pts], c.flat_tolerance_pct):
        return None
    hi_max = float(high.max())
    hi_span = float(high.max() - high.min())
    hi_cut = hi_max - hi_span * 0.35 if hi_span > 0 else hi_max
    sig_highs = [(i, p) for i, p in sh if p >= hi_cut]
    if len(sig_highs) < c.min_swing_points:
        return None
    slope_hi = _slope_pct_per_bar([i for i, _ in sig_highs], [p for _, p in sig_highs])
    highs_pts = sig_highs[-c.min_swing_points :]
    if slope_hi is None or slope_hi > -c.min_slope_pct_per_bar or slope_hi < -c.max_slope_pct_per_bar:
        return None
    support = float(np.mean([p for _, p in lows_pts]))
    hi_i0, hi_p0 = highs_pts[0]
    hi_i1, hi_p1 = highs_pts[-1]
    resistance_now = _line_value(hi_i0, hi_p0, hi_i1, hi_p1, last_i)
    resistance_prev = _line_value(hi_i0, hi_p0, hi_i1, hi_p1, last_i - 1)
    buffer = resistance_now * c.breakout_buffer_pct / 100.0
    status = "forming"
    if last_close > resistance_now + buffer and prev_close <= resistance_prev + buffer:
        status = "breakout_up"
    elif last_close < support and prev_close >= support:
        status = "breakout_down"
    score = min(100.0, 40.0 + abs(slope_hi) * 8.0 + len(highs_pts) * 5.0)
    geom = _geometry(dates_w, support, hi_i0, hi_p0, hi_i1, hi_p1, 0, last_i)
    return {
        "pattern_type": "descending",
        "status": status,
        "score": round(score, 2),
        "resistance_price": round(resistance_now, 4),
        "support_price": round(support, 4),
        "resistance_slope_pct_per_bar": round(slope_hi, 4),
        "support_slope_pct_per_bar": 0.0,
        "geometry": geom,
        "close": round(last_close, 4),
    }


def scan_frame(df: pd.DataFrame, cfg: dict) -> list[dict[str, Any]]:
    """Evaluate both pattern types on the latest bar."""
    tc = _cfg_from_dict(cfg)
    out: list[dict[str, Any]] = []
    for p in ("ascending", "descending"):
        hit = detect_triangle(df, p, tc)
        if hit:
            out.append(hit)
    return out
