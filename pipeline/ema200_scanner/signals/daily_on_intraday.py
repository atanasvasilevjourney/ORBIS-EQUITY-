"""Map daily adjusted EMA200 ribbon onto 5m bars (Phase 3 anchor)."""
from __future__ import annotations

import pandas as pd

from pipeline.compute.atr_risk import compute_atr
from pipeline.ema200_scanner.config.loader import load_config
from pipeline.ema200_scanner.indicators.ema import apply_trust_window, ema_series
from pipeline.ema200_scanner.indicators.ribbon import ribbon_dist_atr


def attach_daily_ema200_step(
    bars_5m: pd.DataFrame,
    daily_adj: pd.DataFrame,
    *,
    ema_period: int | None = None,
    history_min: int | None = None,
    atr_period: int | None = None,
) -> pd.DataFrame:
    """Forward-fill daily EMA200 close/high onto each intraday bar."""
    cfg = load_config()
    ema_period = int(ema_period or cfg["ema_period"])
    history_min = int(history_min or cfg["history_min_bars"])
    atr_period = int(atr_period or cfg["atr_period"])

    daily = daily_adj.sort_index().copy()
    close_d = daily["close"].astype(float)
    ema_d = apply_trust_window(ema_series(close_d, ema_period), history_min_bars=history_min)
    ema_hi_d = apply_trust_window(
        ema_series(daily["high"].astype(float), ema_period),
        history_min_bars=history_min,
    )
    ema_map = {idx.date(): val for idx, val in zip(daily.index, ema_d.values) if pd.notna(val)}
    ema_hi_map = {idx.date(): val for idx, val in zip(daily.index, ema_hi_d.values) if pd.notna(val)}

    out = bars_5m.copy()
    out["ema200_daily"] = [ema_map.get(ts.date()) for ts in out.index]
    out["ema200_high_daily"] = [ema_hi_map.get(ts.date()) for ts in out.index]
    atr = compute_atr(out, period=atr_period)
    out["atr14_5m"] = atr
    out["ribbon_dist_atr_daily"] = ribbon_dist_atr(
        out["close"],
        out["ema200_daily"],
        out["ema200_high_daily"],
        atr,
    )
    vol_sma = out["volume"].astype(float).rolling(20, min_periods=20).mean()
    out["rvol_5m"] = out["volume"].astype(float) / vol_sma.replace(0, pd.NA)
    return out
