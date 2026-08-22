"""Unit tests for pipeline.compute.trend_radar signal functions."""
import pandas as pd
import pytest

from pipeline.compute.trend_radar import (
    BEAR_THRESHOLD,
    BULL_THRESHOLD,
    MIN_HISTORY_DAYS,
    compute_momentum_z,
    compute_quality_rank,
    compute_52w_proximity,
    determine_state,
    process_ticker,
)


class TestComputeMomentumZ:
    def test_insufficient_history_returns_zero(self, flat_prices):
        short = flat_prices.iloc[:50]
        assert compute_momentum_z(short) == 0.0

    def test_uptrend_positive_momentum(self, uptrend_prices):
        z = compute_momentum_z(uptrend_prices)
        assert z > 0

    def test_downtrend_negative_momentum(self, downtrend_prices):
        z = compute_momentum_z(downtrend_prices)
        assert z < 0

    def test_output_bounded(self, uptrend_prices):
        z = compute_momentum_z(uptrend_prices)
        assert -3 <= z <= 3


class TestCompute52wProximity:
    def test_at_high_returns_near_zero(self):
        prices = pd.Series([100.0] * 252)
        assert compute_52w_proximity(prices) == pytest.approx(0.0, abs=0.01)

    def test_below_high_returns_negative(self):
        prices = pd.Series([100.0] * 251 + [80.0])
        prox = compute_52w_proximity(prices)
        assert prox < 0


class TestComputeQualityRank:
    def test_rank_in_valid_range(self):
        rank = compute_quality_rank(1.0, 1.0, -0.05, True, True)
        assert 0 <= rank <= 100

    def test_bullish_signals_high_rank(self):
        rank = compute_quality_rank(2.5, 2.5, -0.02, True, True)
        assert rank >= BULL_THRESHOLD

    def test_bearish_signals_low_rank(self):
        rank = compute_quality_rank(-2.5, -2.5, -0.50, False, False)
        assert rank <= BEAR_THRESHOLD


class TestDetermineState:
    def test_green_state(self):
        state = determine_state(1.5, 1.0, -0.05, 70)
        assert state == 1

    def test_red_state(self):
        state = determine_state(-1.5, -1.0, -0.40, 30)
        assert state == -1

    def test_grey_state(self):
        state = determine_state(0.1, -0.1, -0.15, 50)
        assert state == 0


class TestProcessTicker:
    def test_insufficient_data_returns_none(self):
        df = pd.DataFrame({
            "date": pd.date_range("2024-01-01", periods=50),
            "open": [100.0] * 50,
            "high": [101.0] * 50,
            "low": [99.0] * 50,
            "close": [100.0] * 50,
            "volume": [1_000_000.0] * 50,
        })
        assert process_ticker(df) is None

    def test_sufficient_data_returns_valid_signals(self, price_ohlcv_df):
        result = process_ticker(price_ohlcv_df)
        assert result is not None
        assert 0 <= result["quality_rank"] <= 100
        assert result["state"] in (-1, 0, 1)
        assert isinstance(result["breakout_active"], bool)
        assert isinstance(result["volume_confirmed"], bool)

    def test_min_history_constant(self):
        assert MIN_HISTORY_DAYS == 148
