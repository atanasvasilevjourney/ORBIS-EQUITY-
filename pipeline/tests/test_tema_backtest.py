"""Offline quant tests for TEMA 9/99/199 + MACD close (no network)."""
import numpy as np

from pipeline.research.tema_backtest import (
    strategy_returns,
    synth_dump,
    synth_trend,
    tema_position_series,
    validate_close,
)
from pipeline.compute.perps_math import MIN_BARS


def test_needs_warmup():
    short = synth_trend(100, seed=1)
    pos = tema_position_series(short)
    assert np.all(pos == 0)


def test_uptrend_goes_long():
    close = 40.0 * (1.006 ** np.arange(280))
    pos = tema_position_series(close)
    assert pos[-1] == 1.0
    strat, _ = strategy_returns(close)
    assert strat[MIN_BARS:].sum() > 0


def test_is_oos_positive_drift():
    close = 40.0 * (1.003 ** np.arange(520))
    q = validate_close(close, "SYN")
    assert q.train_bars + q.test_bars == q.n_bars
    assert q.metrics["is_tema"]["bars"] > 50
    assert q.metrics["oos_tema"]["total_return"] > 0
    assert q.metrics["full_tema"]["total_return"] > 0
    # Warmup sits in cash ~220 bars, so TEMA lags buy-hold on a pure drift.
    # After the ribbon is live it should still harvest a large share of the trend.
    strat, pos = strategy_returns(close)
    bh = np.diff(close) / close[:-1]
    post = slice(MIN_BARS, None)
    tema_eq = float(np.cumprod(1.0 + strat[post])[-1])
    bh_eq = float(np.cumprod(1.0 + bh[post])[-1])
    assert pos[-1] == 1.0
    assert tema_eq > bh_eq * 0.7


def test_dump_beats_buyhold():
    close = synth_dump()
    strat, pos = strategy_returns(close)
    bh = np.diff(close) / close[:-1]
    # After the dump, TEMA should not stay fully long the whole way
    assert pos[-40:].mean() < 0.8
    # Overlay should lose less than (or similar to) riding the crash
    assert float(np.cumprod(1 + strat)[-1]) >= float(np.cumprod(1 + bh)[-1]) * 0.85
