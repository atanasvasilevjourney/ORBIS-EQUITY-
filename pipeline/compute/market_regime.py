"""Market regime gate (River-style): SPY trend + realized-vol percentile.

Buys are allowed only when:
  - trend_regime == "bull"  (SPY close >= SMA200)
  - vol_regime == "risk_on" (realized vol percentile <= risk-off threshold)

Pure pandas/numpy — no I/O. Feed SPY (or benchmark) daily OHLCV with a
`close` column covering at least MIN_ROWS_REQUIRED bars.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

SMA_PERIOD = 200
VOL_WINDOW = 20
VOL_PCTL_LOOKBACK = 252
VOL_RISK_OFF_PCTL = 75
MIN_ROWS_REQUIRED = max(SMA_PERIOD, VOL_WINDOW + VOL_PCTL_LOOKBACK)  # 272


def compute_sma(series: pd.Series, period: int = SMA_PERIOD) -> pd.Series:
    return series.rolling(window=period).mean()


def compute_realized_vol(
    close: pd.Series, window: int = VOL_WINDOW
) -> pd.Series:
    """Annualized realized volatility from daily returns."""
    return close.pct_change().rolling(window=window).std() * np.sqrt(252)


def compute_vol_percentile(
    vol: pd.Series, lookback: int = VOL_PCTL_LOOKBACK
) -> pd.Series:
    """Trailing percentile rank of current vol in [0, 100]."""

    def _rank_pct(window: np.ndarray) -> float:
        current = window[-1]
        if not np.isfinite(current):
            return float("nan")
        return 100.0 * float(np.sum(window <= current)) / len(window)

    return vol.rolling(window=lookback).apply(_rank_pct, raw=True)


def trend_regime(price: float, sma200: float) -> str:
    if not np.isfinite(price) or not np.isfinite(sma200):
        return "bear"
    return "bull" if price >= sma200 else "bear"


def vol_regime(vol_percentile: float, threshold: float = VOL_RISK_OFF_PCTL) -> str:
    if vol_percentile is None or (
        isinstance(vol_percentile, float) and math.isnan(vol_percentile)
    ):
        return "risk_off"
    return "risk_off" if vol_percentile > threshold else "risk_on"


def regime_signal(spy_df: pd.DataFrame) -> dict:
    """Classify current market regime from SPY (or benchmark) daily bars.

    Returns dict with trend_regime, vol_regime, buys_allowed, and diagnostics.
    """
    if "close" not in spy_df.columns:
        raise ValueError("spy_df must include a 'close' column")
    if len(spy_df) < MIN_ROWS_REQUIRED:
        raise ValueError(
            f"regime_signal needs at least {MIN_ROWS_REQUIRED} rows "
            f"(got {len(spy_df)})"
        )

    close = spy_df["close"].astype(float)
    sma = compute_sma(close, SMA_PERIOD)
    vol = compute_realized_vol(close, VOL_WINDOW)
    pctl = compute_vol_percentile(vol, VOL_PCTL_LOOKBACK)

    price = float(close.iloc[-1])
    sma_val = float(sma.iloc[-1])
    vol_val = float(vol.iloc[-1])
    pctl_val = float(pctl.iloc[-1])

    trend = trend_regime(price, sma_val)
    vol_reg = vol_regime(pctl_val)
    buys_allowed = trend == "bull" and vol_reg == "risk_on"

    return {
        "trend_regime": trend,
        "vol_regime": vol_reg,
        "buys_allowed": buys_allowed,
        "spy_price": price,
        "spy_sma200": sma_val,
        "realized_vol": vol_val,
        "vol_percentile": pctl_val,
    }


def apply_regime_filter(signal: str, regime: dict) -> str:
    """Downgrade buy → hold when market regime disallows new risk.

    Sells/exits always pass. Unknown signals unchanged.
    """
    if signal == "buy" and not regime.get("buys_allowed", False):
        return "hold"
    return signal


def regime_series(spy_df: pd.DataFrame) -> pd.DataFrame:
    """Daily buys_allowed / trend / vol flags aligned to spy_df.index.

    Useful for backtests that gate entries bar-by-bar.
    """
    close = spy_df["close"].astype(float)
    sma = compute_sma(close, SMA_PERIOD)
    vol = compute_realized_vol(close, VOL_WINDOW)
    pctl = compute_vol_percentile(vol, VOL_PCTL_LOOKBACK)

    trend = np.where(close >= sma, "bull", "bear")
    # NaN pctl → risk_off
    vol_reg = np.where(
        (pctl.isna()) | (pctl > VOL_RISK_OFF_PCTL),
        "risk_off",
        "risk_on",
    )
    buys = (trend == "bull") & (vol_reg == "risk_on")

    return pd.DataFrame(
        {
            "trend_regime": trend,
            "vol_regime": vol_reg,
            "buys_allowed": buys,
            "spy_sma200": sma.values,
            "realized_vol": vol.values,
            "vol_percentile": pctl.values,
        },
        index=spy_df.index,
    )
