"""Trend-band pullback + band-flip detection (pure, no I/O)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
import pandas as pd

from pipeline.trend_band_scanner.indicators.band import compute_band_frame

SetupKind = Literal["pullback", "band_flip"]


@dataclass(frozen=True)
class PullbackParams:
    ema_fast: int = 20
    ema_slow: int = 50
    slope_lookback: int = 5
    min_band_slope_pct: float = 0.02
    swing_high_lookback: int = 40
    min_advance_pct: float = 6.0
    min_pullback_pct: float = 2.5
    max_pullback_pct: float = 22.0
    proximity_pct: float = 2.5
    low_touch_extra_pct: float = 1.5
    flip_lookback_days: int = 12
    spark_bars: int = 90


def _cfg_params(cfg: dict) -> PullbackParams:
    pb = cfg.get("pullback") or {}
    flip = cfg.get("band_flip") or {}
    scan = cfg.get("scan") or {}
    return PullbackParams(
        ema_fast=int(cfg.get("ema_fast", 20)),
        ema_slow=int(cfg.get("ema_slow", 50)),
        slope_lookback=int(cfg.get("slope_lookback", 5)),
        min_band_slope_pct=float(cfg.get("min_band_slope_pct", 0.02)),
        swing_high_lookback=int(pb.get("swing_high_lookback", 40)),
        min_advance_pct=float(pb.get("min_advance_pct", 6.0)),
        min_pullback_pct=float(pb.get("min_pullback_pct", 2.5)),
        max_pullback_pct=float(pb.get("max_pullback_pct", 22.0)),
        proximity_pct=float(pb.get("proximity_pct", 2.5)),
        low_touch_extra_pct=float(pb.get("low_touch_extra_pct", 1.5)),
        flip_lookback_days=int(flip.get("flip_lookback_days", 12)),
        spark_bars=int(scan.get("spark_bars", 90)),
    )


def _spark_payload(
    df: pd.DataFrame,
    band: pd.DataFrame,
    n: int,
) -> list[dict[str, Any]]:
    tail = df.tail(n).reset_index(drop=True)
    band_tail = band.tail(n).reset_index(drop=True)
    out: list[dict[str, Any]] = []
    for j in range(len(tail)):
        row = tail.iloc[j]
        b = band_tail.iloc[j]
        if pd.isna(b["ema_fast"]) or pd.isna(b["ema_slow"]):
            continue
        d = row["date"] if "date" in tail.columns else j
        if hasattr(d, "isoformat"):
            d = d.isoformat()[:10]
        else:
            d = str(d)[:10]
        out.append(
            {
                "date": d,
                "close": float(row["close"]),
                "emaFast": float(b["ema_fast"]),
                "emaSlow": float(b["ema_slow"]),
                "rising": bool(b["band_rising"]),
            }
        )
    return out


def _score(
    *,
    dist_pct: float,
    slope_pct: float,
    pullback_pct: float,
    band_flip: bool,
    params: PullbackParams,
) -> float:
    prox = max(0.0, 100.0 - dist_pct * (100.0 / max(params.proximity_pct * 2, 0.01)))
    prox = float(np.clip(prox * 0.4, 0, 40))
    trend = float(np.clip(slope_pct * 8.0, 0, 25))
    sweet = 10.0
    pb_dist = abs(pullback_pct - sweet)
    pull = float(np.clip(20.0 - pb_dist * 1.5, 0, 20))
    flip_bonus = 15.0 if band_flip else 0.0
    return round(prox + trend + pull + flip_bonus, 2)


def scan_frame(ohlcv: pd.DataFrame, cfg: dict) -> dict[str, Any] | None:
    """Return one setup dict for the last bar, or None."""
    params = _cfg_params(cfg)
    if "date" in ohlcv.columns:
        df = ohlcv.sort_values("date").reset_index(drop=True)
    else:
        df = ohlcv.sort_index().reset_index(drop=True)
    if len(df) < params.ema_slow + params.swing_high_lookback + 5:
        return None

    close = df["close"].astype(float)
    low = df["low"].astype(float)
    high = df["high"].astype(float)

    band = compute_band_frame(
        close,
        ema_fast=params.ema_fast,
        ema_slow=params.ema_slow,
        slope_lookback=params.slope_lookback,
        min_band_slope_pct=params.min_band_slope_pct,
    )
    i = -1
    rising = bool(band["band_rising"].iloc[i])
    if not rising:
        flip_age = band["days_since_flip"].iloc[i]
        if pd.isna(flip_age) or float(flip_age) > params.flip_lookback_days:
            return None

    band_lo = float(band["band_lo"].iloc[i])
    band_hi = float(band["band_hi"].iloc[i])
    last_close = float(close.iloc[i])
    last_low = float(low.iloc[i])

    if not np.isfinite(band_lo) or band_lo <= 0:
        return None

    # Invalidation: decisive close below band support
    if last_close < band_lo * (1.0 - params.low_touch_extra_pct / 100.0):
        return None

    look = params.swing_high_lookback
    recent_high = float(high.iloc[-look:].max())
    if recent_high <= 0:
        return None

    pullback_pct = (recent_high - last_close) / recent_high * 100.0
    if pullback_pct < params.min_pullback_pct or pullback_pct > params.max_pullback_pct:
        return None

    anchor_low = float(low.iloc[-look:].min())
    advance_pct = (recent_high - anchor_low) / anchor_low * 100.0 if anchor_low > 0 else 0.0
    if advance_pct < params.min_advance_pct:
        return None

    dist_to_band = (last_close - band_hi) / band_hi * 100.0
    touched = last_low <= band_hi * (1.0 + params.low_touch_extra_pct / 100.0)
    near = dist_to_band <= params.proximity_pct
    if not (touched or near):
        return None

    mid_lag = band["band_mid"].iloc[i - params.slope_lookback] if len(band) > params.slope_lookback else np.nan
    mid_now = float(band["band_mid"].iloc[i])
    slope_pct = (
        (mid_now - float(mid_lag)) / float(mid_lag) * 100.0
        if mid_lag and np.isfinite(mid_lag) and float(mid_lag) > 0
        else 0.0
    )

    flip_age_val = band["days_since_flip"].iloc[i]
    band_flip = (
        rising
        and flip_age_val is not None
        and not pd.isna(flip_age_val)
        and float(flip_age_val) <= params.flip_lookback_days
    )
    setup_kind: SetupKind = "band_flip" if band_flip else "pullback"

    score = _score(
        dist_pct=max(0.0, dist_to_band),
        slope_pct=slope_pct,
        pullback_pct=pullback_pct,
        band_flip=band_flip,
        params=params,
    )

    spark = _spark_payload(df, band, params.spark_bars)

    return {
        "setup_kind": setup_kind,
        "score": score,
        "close": last_close,
        "band_lo": band_lo,
        "band_hi": band_hi,
        "invalidation": band_lo,
        "dist_to_band_pct": round(dist_to_band, 3),
        "pullback_pct": round(pullback_pct, 3),
        "advance_pct": round(advance_pct, 3),
        "band_slope_pct": round(slope_pct, 4),
        "band_color": str(band["band_color"].iloc[i]),
        "band_flip": band_flip,
        "days_since_flip": int(flip_age_val) if band_flip and not pd.isna(flip_age_val) else None,
        "spark": spark,
        "ema_fast": params.ema_fast,
        "ema_slow": params.ema_slow,
    }