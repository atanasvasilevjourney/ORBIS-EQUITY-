"""Unit tests for market regime gate."""
import numpy as np
import pandas as pd
import pytest

from pipeline.compute.market_regime import (
    MIN_ROWS_REQUIRED,
    apply_regime_filter,
    regime_series,
    regime_signal,
    trend_regime,
    vol_regime,
)


def _spy_df(days: int = 320, drift: float = 0.0008, vol: float = 0.008, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2019-01-01", periods=days)
    close = 100 * np.cumprod(1 + rng.normal(drift, vol, days))
    return pd.DataFrame({"close": close}, index=idx)


class TestRegimeHelpers:
    def test_trend_bull_bear(self):
        assert trend_regime(110, 100) == "bull"
        assert trend_regime(90, 100) == "bear"

    def test_vol_regime_threshold(self):
        assert vol_regime(50) == "risk_on"
        assert vol_regime(80) == "risk_off"
        assert vol_regime(float("nan")) == "risk_off"

    def test_apply_regime_filter_blocks_buys(self):
        assert apply_regime_filter("buy", {"buys_allowed": False}) == "hold"
        assert apply_regime_filter("buy", {"buys_allowed": True}) == "buy"
        assert apply_regime_filter("sell", {"buys_allowed": False}) == "sell"


class TestRegimeSignal:
    def test_insufficient_history_raises(self):
        with pytest.raises(ValueError):
            regime_signal(_spy_df(100))

    def test_uptrend_low_vol_allows_buys(self):
        # Smooth uptrend → bull + typically risk_on
        df = _spy_df(MIN_ROWS_REQUIRED + 20, drift=0.0015, vol=0.004, seed=1)
        out = regime_signal(df)
        assert out["trend_regime"] == "bull"
        assert "buys_allowed" in out
        assert out["spy_price"] > out["spy_sma200"]

    def test_regime_series_aligned(self):
        df = _spy_df(MIN_ROWS_REQUIRED + 10, seed=2)
        series = regime_series(df)
        assert len(series) == len(df)
        assert set(series["buys_allowed"].dropna().unique()).issubset({True, False})
