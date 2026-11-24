"""Trend-band pullback on pb_ema EMA200 high/low band (daily or weekly bars)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
import pandas as pd

from pipeline.trend_band_scanner.indicators.band import compute_pb_ema_band_frame

SetupKind = Literal["pullback", "band_flip"]
Timeframe = Literal["1d", "1wk"]


@dataclass(frozen=True)
class PullbackParams:
    ema_period: int = 200
    history_min_bars: int = 200
    slope_lookback: int = 20
    min_band_slope_pct: float = 0.0
    swing_high_lookback: int = 40
    min_advance_pct: float = 6.0
    min_pullback_pct: float = 2.5
    max_pullback_pct: float = 28.0
    proximity_pct: float = 3.0
    low_touch_extra_pct: float = 1.5
    flip_lookback_days: int = 12
    spark_bars: int = 90


def params_for_timeframe(cfg: dict, timeframe: Timeframe) -> PullbackParams:
    pb = cfg.get("pullback") or {}
    flip = cfg.get("band_flip") or {}
    band = cfg.get("band") or {}
    scan = cfg.get("scan") or {}
    weekly = timeframe == "1wk"
    return PullbackParams(
        ema_period=int(cfg.get("ema_period", 200)),
        history_min_bars=int(
            cfg.get("weekly_history_min_bars" if weekly else "history_min_bars", 220 if weekly else 200)
        ),
        slope_lookback=int(
            band.get("slope_lookback_weekly" if weekly else "slope_lookback_daily", 8 if weekly else 20)
        ),
        min_band_slope_pct=float(band.get("min_band_slope_pct", 0.0)),
        swing_high_lookback=int(
            pb.get("swing_high_lookback_weekly" if weekly else "swing_high_lookback_daily", 16 if weekly else 40)
        ),
        min_advance_pct=float(pb.get("min_advance_pct", 6.0)),
        min_pullback_pct=float(pb.get("min_pullback_pct", 2.5)),
        max_pullback_pct=float(pb.get("max_pullback_pct", 28.0)),
        proximity_pct=float(pb.get("proximity_pct", 3.0)),
        low_touch_extra_pct=float(pb.get("low_touch_extra_pct", 1.5)),
        flip_lookback_days=int(flip.get("flip_lookback_weekly" if weekly else "flip_lookback_daily", 6 if weekly else 12)),
        spark_bars=int(scan.get("spark_bars_weekly" if weekly else "spark_bars_daily", 52 if weekly else 90)),
    )


def _spark_payload(df: pd.DataFrame, band: pd.DataFrame, n: int) -> list[dict[str, Any]]:
    tail = df.tail(n).reset_index(drop=True)
    band_tail = band.tail(n).reset_index(drop=True)
    out: list[dict[str, Any]] = []
    for j in range(len(tail)):
        row = tail.iloc[j]
        b = band_tail.iloc[j]
        if pd.isna(b["ema200_high"]) or pd.isna(b["ema200_low"]):
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
                "ema200High": float(b["ema200_high"]),
                "ema200Low": float(b["ema200_low"]),
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
    trend = float(np.clip(abs(slope_pct) * 4.0, 0, 25))
    sweet = 10.0
    pb_dist = abs(pullback_pct - sweet)
    pull = float(np.clip(20.0 - pb_dist * 1.5, 0, 20))
    flip_bonus = 15.0 if band_flip else 0.0
    return round(prox + trend + pull + flip_bonus, 2)


def scan_frame(
    ohlcv: pd.DataFrame,
    cfg: dict,
    *,
    timeframe: Timeframe = "1d",
) -> dict[str, Any] | None:
    params = params_for_timeframe(cfg, timeframe)
    if "date" in ohlcv.columns:
        df = ohlcv.sort_values("date").reset_index(drop=True)
    else:
        df = ohlcv.sort_index().reset_index(drop=True)

    need = params.history_min_bars + params.swing_high_lookback + 5
    if len(df) < need:
        return None

    close = df["close"].astype(float)
    low = df["low"].astype(float)
    high = df["high"].astype(float)

    ohlc = pd.DataFrame({"close": close, "high": high, "low": low})
    band = compute_pb_ema_band_frame(
        ohlc,
        ema_period=params.ema_period,
        history_min_bars=params.history_min_bars,
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

    if last_close < band_lo:
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

    slope_pct = float(band["band_slope_pct"].iloc[i] or 0.0)

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
        "timeframe": timeframe,
        "setup_kind": setup_kind,
        "score": score,
        "close": last_close,
        "band_lo": band_lo,
        "band_hi": band_hi,
        "ema200_high": band_hi,
        "ema200_low": band_lo,
        "invalidation": band_lo,
        "dist_to_band_pct": round(dist_to_band, 3),
        "pullback_pct": round(pullback_pct, 3),
        "advance_pct": round(advance_pct, 3),
        "band_slope_pct": round(slope_pct, 4),
        "band_color": str(band["band_color"].iloc[i]),
        "band_flip": band_flip,
        "days_since_flip": int(flip_age_val) if band_flip and not pd.isna(flip_age_val) else None,
        "spark": spark,
        "ema_period": params.ema_period,
    }