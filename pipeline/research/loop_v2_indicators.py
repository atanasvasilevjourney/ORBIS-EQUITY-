"""LOOP v2 RGD add-on indicators (pre-declared, no post-hoc tuning)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline.compute.atr_risk import compute_atr

ER_PERIOD = 10
ER_EMA_SPAN = 3
ER_MIN = 0.30
VOL_RANK_WINDOW = 100
ATR_RANK_PERIOD = 14
CHANNEL_HIGH = 55
CHANNEL_LOW = 34
VOL_RANK_MEDIAN = 50.0


def kaufman_efficiency_ratio(close: pd.Series, period: int = ER_PERIOD) -> pd.Series:
    """Kaufman ER: |N-period change| / sum of |1-bar changes| over N."""
    close = close.astype(float)
    change = (close - close.shift(period)).abs()
    volatility = close.diff().abs().rolling(period, min_periods=period).sum()
    er = change / volatility.replace(0, np.nan)
    return er.clip(0, 1)


def efficiency_ratio_smoothed(
    close: pd.Series,
    period: int = ER_PERIOD,
    ema_span: int = ER_EMA_SPAN,
) -> pd.Series:
    """ER smoothed by EMA(ema_span)."""
    return kaufman_efficiency_ratio(close, period).ewm(span=ema_span, adjust=False).mean()


def atr_close_percentile_rank(
    ohlcv: pd.DataFrame,
    atr_period: int = ATR_RANK_PERIOD,
    window: int = VOL_RANK_WINDOW,
) -> pd.Series:
    """Percentile rank (0–100) of ATR(14)/close over trailing ``window`` days."""
    d = ohlcv.sort_index()
    close = d["close"].astype(float)
    atr = compute_atr(d.reset_index(drop=True), period=atr_period)
    atr.index = d.index
    ratio = (atr / close.replace(0, np.nan)).astype(float)

    def _pct_rank_last(w: pd.Series) -> float:
        if len(w) < 2 or not np.isfinite(w.iloc[-1]):
            return np.nan
        return float((w <= w.iloc[-1]).mean() * 100.0)

    return ratio.rolling(window, min_periods=window).apply(_pct_rank_last, raw=False)


def vol_switch_upper(high: pd.Series, vol_rank: pd.Series) -> pd.Series:
    """55-day upper if vol rank > median else 34-day upper (shifted 1 bar)."""
    high = high.astype(float)
    upper_55 = high.rolling(CHANNEL_HIGH, min_periods=CHANNEL_HIGH).max().shift(1)
    upper_34 = high.rolling(CHANNEL_LOW, min_periods=CHANNEL_LOW).max().shift(1)
    use_long = vol_rank > VOL_RANK_MEDIAN
    out = upper_34.copy()
    out.loc[use_long.fillna(False)] = upper_55.loc[use_long.fillna(False)]
    return out