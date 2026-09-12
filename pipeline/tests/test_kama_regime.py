"""Unit tests for dual-KAMA regime and Trend Radar integration."""
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from pipeline.compute.kama_regime import (
    calculate_kama,
    compute_kama_regime,
    dual_kama_position,
)
from pipeline.compute.trend_radar import (
    compute_quality_rank,
    determine_state,
    process_ticker,
)


def _uptrend_close(days: int = 200, seed: int = 1) -> pd.Series:
    # Smooth geometric uptrend — dual-KAMA should read bullish after warmup
    prices = 100.0 * (1.002 ** np.arange(days))
    return pd.Series(prices)


def _downtrend_close(days: int = 200, seed: int = 2) -> pd.Series:
    prices = 100.0 * (0.998 ** np.arange(days))
    return pd.Series(prices)


class TestCalculateKama:
    def test_length_matches_input(self):
        s = _uptrend_close(80)
        k = calculate_kama(s, n=10)
        assert len(k) == len(s)
        assert k.iloc[:10].isna().all()
        assert np.isfinite(k.iloc[-1])

    def test_short_series_all_nan(self):
        s = pd.Series([1.0, 2.0, 3.0])
        k = calculate_kama(s, n=10)
        assert k.isna().all()


class TestDualKamaRegime:
    def test_uptrend_bullish(self):
        assert compute_kama_regime(_uptrend_close()) == 1

    def test_downtrend_bearish(self):
        assert compute_kama_regime(_downtrend_close()) == -1

    def test_position_shifted(self):
        close = _uptrend_close(120)
        pos = dual_kama_position(close)
        assert pos.iloc[0] == 0.0
        assert set(pos.dropna().unique()).issubset({0.0, 1.0})


class TestTrendRadarKamaIntegration:
    def test_quality_rank_rewards_bullish_kama(self):
        bull = compute_quality_rank(1.0, 1.0, -0.05, True, True, kama_regime=1)
        bear = compute_quality_rank(1.0, 1.0, -0.05, True, True, kama_regime=-1)
        assert bull > bear

    def test_green_blocked_when_kama_bearish(self):
        # High rank + positives but bearish KAMA → not GREEN
        state = determine_state(1.5, 1.0, -0.05, 70, kama_regime=-1)
        assert state != 1

    def test_green_allowed_when_kama_bullish(self):
        state = determine_state(1.5, 1.0, -0.05, 70, kama_regime=1)
        assert state == 1

    def test_process_ticker_includes_kama_regime(self):
        days = 200
        rng = np.random.default_rng(7)
        dates = [date.today() - timedelta(days=days - i) for i in range(days)]
        close = 100.0 * np.cumprod(1 + rng.normal(0.001, 0.015, days))
        df = pd.DataFrame({
            "date": dates,
            "open": close,
            "high": close * 1.01,
            "low": close * 0.99,
            "close": close,
            "volume": rng.integers(500_000, 2_000_000, days).astype(float),
        })
        result = process_ticker(df)
        assert result is not None
        assert "kama_regime" in result
        assert result["kama_regime"] in (-1, 0, 1)
        assert 0 <= result["quality_rank"] <= 100
