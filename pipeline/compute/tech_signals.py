"""Technical signal library — port of MorcilloSanz/stockanalysis `analysis.py`.

Codes: 1 = SELL, 2 = BUY, 3 = HOLD. Indicators match the source formulas
(SMA via centered window, EMA with SMA seed, Wilder RSI, MACD 12/26/9).
"""
from __future__ import annotations

import numpy as np

CODE_SELL = 1
CODE_BUY = 2
CODE_HOLD = 3
ZERO_THRESHOLD = 0.01


def low_pass(series: np.ndarray, window_size: int = 3) -> np.ndarray:
    n = len(series)
    out = np.empty(n, dtype=float)
    half = window_size // 2
    for i in range(n):
        start = max(0, i - half)
        end = min(n, i + half + 1)
        out[i] = float(np.mean(series[start:end]))
    return out


def SMA(series: np.ndarray, period: int) -> np.ndarray:
    return low_pass(series, period)


def EMA(series: np.ndarray, period: int) -> np.ndarray:
    alpha = 2 / (period + 1)
    ema = np.full(len(series), np.nan, dtype=float)
    if len(series) < period:
        return ema
    ema[period - 1] = float(np.mean(series[:period]))
    for i in range(period, len(series)):
        ema[i] = series[i] * alpha + ema[i - 1] * (1 - alpha)
    return ema


def MACD(close: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9):
    ema_fast = EMA(close, fast)
    ema_slow = EMA(close, slow)
    macd_line = ema_fast - ema_slow
    signal_line = EMA(np.nan_to_num(macd_line, nan=0.0), signal)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def RSI(close: np.ndarray, period: int = 14) -> np.ndarray:
    deltas = np.diff(close)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = np.zeros(len(close), dtype=float)
    avg_loss = np.zeros(len(close), dtype=float)
    if len(close) <= period:
        return np.full(len(close), 50.0)
    avg_gain[period] = float(gains[:period].mean())
    avg_loss[period] = float(losses[:period].mean())
    for i in range(period + 1, len(close)):
        avg_gain[i] = (avg_gain[i - 1] * (period - 1) + gains[i - 1]) / period
        avg_loss[i] = (avg_loss[i - 1] * (period - 1) + losses[i - 1]) / period
    rsi = np.zeros(len(close), dtype=float)
    for i in range(len(close)):
        if avg_loss[i] == 0 and avg_gain[i] == 0:
            rsi[i] = 50.0
        elif avg_loss[i] == 0:
            rsi[i] = 100.0
        elif avg_gain[i] == 0:
            rsi[i] = 0.0
        else:
            rs = avg_gain[i] / avg_loss[i]
            rsi[i] = 100.0 - (100.0 / (1.0 + rs))
    rsi[:period] = 50.0
    return rsi


def linear_regression(series: np.ndarray) -> tuple[float, float]:
    k = len(series)
    x = np.arange(k, dtype=float)
    y = np.asarray(series, dtype=float)
    sum_x = float(np.sum(x))
    sum_y = float(np.sum(y))
    sum_xy = float(np.sum(x * y))
    sum_x2 = float(np.sum(x * x))
    denom = k * sum_x2 - sum_x ** 2
    if denom == 0:
        return 0.0, float(sum_y / k) if k else 0.0
    m = (k * sum_xy - sum_x * sum_y) / denom
    n = (sum_y - m * sum_x) / k
    return float(m), float(n)


def _last2(arr: np.ndarray) -> tuple[float, float] | None:
    if arr is None or len(arr) < 2:
        return None
    a, b = float(arr[-2]), float(arr[-1])
    if not np.isfinite(a) or not np.isfinite(b):
        return None
    return a, b


def signal_linear_regression(m: float) -> tuple[int, str]:
    if -ZERO_THRESHOLD <= m < ZERO_THRESHOLD:
        return CODE_HOLD, "no slope"
    if m > 0:
        return CODE_BUY, "positive slope"
    return CODE_SELL, "negative slope"


def signal_moving_averages_long_term(sma100, sma200, ema50, ema100, close) -> tuple[int, str]:
    e50 = _last2(ema50)
    s200 = _last2(sma200)
    c = _last2(close)
    e100 = _last2(ema100)
    s100 = _last2(sma100)
    if e50 and s200:
        if e50[0] < s200[0] and e50[1] > s200[1]:
            return CODE_BUY, "Golden Cross (strong buy)"
        if e50[0] > s200[0] and e50[1] < s200[1]:
            return CODE_SELL, "Death Cross (strong sell)"
    if c and e50:
        if c[0] < e50[0] and c[1] > e50[1]:
            return CODE_BUY, "price crossed above EMA 50"
        if c[0] > e50[0] and c[1] < e50[1]:
            return CODE_SELL, "price crossed below EMA 50"
    if c and e100:
        if c[0] < e100[0] and c[1] > e100[1]:
            return CODE_BUY, "price crossed above EMA 100"
        if c[0] > e100[0] and c[1] < e100[1]:
            return CODE_SELL, "price crossed below EMA 100"
    if c and s100:
        if c[0] < s100[0] and c[1] > s100[1]:
            return CODE_BUY, "price crossed above SMA 100"
        if c[0] > s100[0] and c[1] < s100[1]:
            return CODE_SELL, "price crossed below SMA 100"
    if c and s200:
        if c[0] < s200[0] and c[1] > s200[1]:
            return CODE_BUY, "price crossed above SMA 200"
        if c[0] > s200[0] and c[1] < s200[1]:
            return CODE_SELL, "price crossed below SMA 200"
    return CODE_HOLD, "no signal detected"


def moving_averages_signal_mid_term(sma50, sma100, ema20, ema50, close) -> tuple[int, str]:
    e50 = _last2(ema50)
    s100 = _last2(sma100)
    c = _last2(close)
    e20 = _last2(ema20)
    s50 = _last2(sma50)
    if e50 and s100:
        if e50[0] < s100[0] and e50[1] > s100[1]:
            return CODE_BUY, "Golden Cross (strong buy)"
        if e50[0] > s100[0] and e50[1] < s100[1]:
            return CODE_SELL, "Death Cross (strong sell)"
    if c and e50:
        if c[0] < e50[0] and c[1] > e50[1]:
            return CODE_BUY, "price crossed above EMA 50"
        if c[0] > e50[0] and c[1] < e50[1]:
            return CODE_SELL, "price crossed below EMA 50"
    if c and e20:
        if c[0] < e20[0] and c[1] > e20[1]:
            return CODE_BUY, "price crossed above EMA 20"
        if c[0] > e20[0] and c[1] < e20[1]:
            return CODE_SELL, "price crossed below EMA 20"
    if c and s50:
        if c[0] < s50[0] and c[1] > s50[1]:
            return CODE_BUY, "price crossed above SMA 50"
        if c[0] > s50[0] and c[1] < s50[1]:
            return CODE_SELL, "price crossed below SMA 50"
    if c and s100:
        if c[0] < s100[0] and c[1] > s100[1]:
            return CODE_BUY, "price crossed above SMA 100"
        if c[0] > s100[0] and c[1] < s100[1]:
            return CODE_SELL, "price crossed below SMA 100"
    return CODE_HOLD, "no signal detected"


def decision_tree_signal(close_d: float, volume_d: float) -> tuple[int, str]:
    if close_d > 0 and volume_d > 0:
        return CODE_BUY, "positive trend"
    if close_d > 0 and volume_d < 0:
        return CODE_HOLD, "weak trend"
    if close_d < 0 and volume_d > 0:
        return CODE_SELL, "negative trend"
    return CODE_HOLD, "weak trend"


def macd_signal_mid_term(macd_line: np.ndarray) -> tuple[int, str]:
    pair = _last2(macd_line)
    if not pair:
        return CODE_HOLD, "no signal detected"
    a, b = pair
    if a < 0 <= b:
        return CODE_BUY, "MACD crossed above zero -> bullish momentum"
    if b > 0 and b > a:
        return CODE_BUY, "MACD positive and rising -> bullish trend"
    if a > 0 >= b:
        return CODE_SELL, "MACD crossed below zero -> bearish momentum"
    if b < 0 and b < a:
        return CODE_SELL, "MACD negative and falling -> bearish trend"
    return CODE_HOLD, "no signal detected"


def rsi_signal_mid_term(rsi: np.ndarray) -> tuple[int, str]:
    if rsi is None or len(rsi) == 0 or not np.isfinite(rsi[-1]):
        return CODE_HOLD, "no signal detected"
    last = float(rsi[-1])
    if last > 70:
        return CODE_SELL, "RSI > 70 -> Overbought, possible sell signal"
    if last < 30:
        return CODE_BUY, "RSI < 30 -> Oversold, possible buy signal"
    return CODE_HOLD, "no signal detected"
