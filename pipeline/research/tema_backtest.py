"""IS/OOS quant test for TEMA 9/99/199 + MACD close.

Research harness (not the nightly pipeline). Synthetic or local closes.
Enter when close > TEMA-199 and TEMA-9 > TEMA-99 (short is the inverse).
Flatten on MACD CLOSE or when the swing rule goes FLAT.

Usage:
    PYTHONPATH=/workspace python -m pipeline.research.tema_backtest
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from pipeline.compute.perps_math import (
    MIN_BARS,
    TEMA_FAST,
    TEMA_MID,
    TEMA_SLOW,
    macd,
    macd_close_action,
    tema,
)
from pipeline.research.kama_backtest import compute_metrics

BARS_PER_YEAR = 252.0


@dataclass(frozen=True)
class TemaQuant:
    ticker: str
    n_bars: int
    train_bars: int
    test_bars: int
    metrics: dict[str, dict]


def tema_position_series(close: np.ndarray) -> np.ndarray:
    """+1 long / −1 short / 0 flat. Causal: uses prints through bar i inclusive."""
    x = np.asarray(close, dtype=float)
    n = x.size
    pos = np.zeros(n)
    if n < MIN_BARS:
        return pos
    high = x * 1.004
    low = x * 0.996
    t9 = tema(x, TEMA_FAST)
    t99 = tema(x, TEMA_MID)
    t199 = tema(x, TEMA_SLOW)
    line, sig, _hist = macd(x)
    live = 0.0
    start = MIN_BARS - 1
    for i in range(start, n):
        last = float(x[i])
        regime_up = last > t199[i]
        regime_dn = last < t199[i]
        trigger_up = t9[i] > t99[i]
        trigger_dn = t9[i] < t99[i]
        if regime_up and trigger_up:
            side = "BUY"
        elif regime_dn and trigger_dn:
            side = "SELL"
        else:
            side = "FLAT"
        action = macd_close_action(side, float(line[i]), float(sig[i]))
        if action == "CLOSE" or side == "FLAT":
            live = 0.0
        elif side == "BUY":
            live = 1.0
        else:
            live = -1.0
        pos[i] = live
    return pos


def strategy_returns(close: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    x = np.asarray(close, dtype=float)
    rets = np.diff(x) / np.where(x[:-1] == 0, np.nan, x[:-1])
    rets = np.nan_to_num(rets, nan=0.0)
    pos = tema_position_series(x)
    # next-bar: position from close[i] applies to return[i] (close[i]→close[i+1])
    strat = pos[:-1] * rets
    return strat, pos


def synth_trend(days: int = 500, drift: float = 0.0012, vol: float = 0.008, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    rets = rng.normal(drift, vol, days)
    return 40.0 * np.cumprod(1.0 + rets)


def synth_dump(up_days: int = 280, down_days: int = 180, seed: int = 4) -> np.ndarray:
    up = synth_trend(up_days, drift=0.0015, vol=0.006, seed=seed)
    down = up[-1] * np.cumprod(1.0 + np.random.default_rng(seed + 1).normal(-0.0025, 0.01, down_days))
    return np.concatenate([up, down])


def split_close(close: np.ndarray, train_ratio: float = 0.6) -> tuple[np.ndarray, np.ndarray]:
    idx = int(len(close) * train_ratio)
    return np.asarray(close[:idx], dtype=float), np.asarray(close[idx:], dtype=float)


def validate_close(close: np.ndarray, ticker: str = "SYN") -> TemaQuant:
    x = np.asarray(close, dtype=float)
    train, test = split_close(x, 0.6)
    strat, pos = strategy_returns(x)
    bh = np.diff(x) / np.where(x[:-1] == 0, 1.0, x[:-1])
    idx = int(x.size * 0.6)
    slices = {
        "full": (strat, pos[:-1], bh),
        "is": (strat[: idx - 1], pos[: idx - 1], bh[: idx - 1]),
        "oos": (strat[idx - 1 :], pos[idx - 1 : -1], bh[idx - 1 :]),
    }
    metrics = {}
    for label, (sr, p, bhr) in slices.items():
        metrics[f"{label}_tema"] = asdict(compute_metrics(sr, position=p))
        metrics[f"{label}_buyhold"] = asdict(compute_metrics(bhr, position=np.ones(len(bhr))))
    return TemaQuant(
        ticker=ticker,
        n_bars=int(x.size),
        train_bars=int(train.size),
        test_bars=int(test.size),
        metrics=metrics,
    )


def main() -> None:
    q = validate_close(synth_trend(600, seed=7), "SYN-TREND")
    print(q.ticker, q.n_bars, "IS Sharpe", round(q.metrics["is_tema"]["sharpe"], 3),
          "vs BH", round(q.metrics["is_buyhold"]["sharpe"], 3))


if __name__ == "__main__":
    main()
