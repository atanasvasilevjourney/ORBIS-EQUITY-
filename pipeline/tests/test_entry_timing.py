"""Tests for entry timing vetoes."""
import numpy as np
import pandas as pd

from pipeline.compute.entry_timing import (
    MAX_RUNUP_BLOCK,
    evaluate_entry_timing,
)


def _ohlc_from_closes(closes: list[float]) -> tuple[pd.Series, pd.Series, pd.Series]:
    idx = pd.bdate_range("2020-01-01", periods=len(closes))
    close = pd.Series(closes, index=idx, dtype=float)
    high = close * 1.01
    low = close * 0.99
    return close, high, low


def test_too_late_on_large_runup():
    # Flat then spike >50% from 50d low
    base = [100.0] * 60
    base[-1] = 100.0 * (1.0 + MAX_RUNUP_BLOCK + 0.05)
    close, high, low = _ohlc_from_closes(base)
    result = evaluate_entry_timing(close, high, low)
    assert result.is_too_late
    assert result.label == "too_late"


def test_ok_on_modest_trend():
    closes = [100 + i * 0.1 for i in range(80)]
    close, high, low = _ohlc_from_closes(closes)
    result = evaluate_entry_timing(close, high, low)
    assert result.label in ("ok", "wait_pullback")
    assert not result.is_too_late


def test_wait_pullback_on_extension():
    # Gradual climb then extend ~8% above MA20 without hitting hard block
    closes = [100.0] * 40 + [100 + i for i in range(1, 21)]
    # Last ~120 vs MA20 ~110 → ~9% extension → wait, not too_late (block at 12%)
    close, high, low = _ohlc_from_closes(closes)
    result = evaluate_entry_timing(close, high, low)
    assert result.label in ("wait_pullback", "too_late")
