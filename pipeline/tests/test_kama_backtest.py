"""Unit tests for KAMA IS/OOS backtest helpers (no network)."""
import numpy as np
import pandas as pd
import pytest

from pipeline.research.kama_backtest import (
    compute_metrics,
    default_param_grid,
    metrics_for_close,
    production_params,
    split_train_test,
    validate_ticker,
)


def _synth_close(days: int = 500, drift: float = 0.0008, seed: int = 0) -> pd.Series:
    rng = np.random.default_rng(seed)
    rets = rng.normal(drift, 0.012, days)
    prices = 100.0 * np.cumprod(1 + rets)
    idx = pd.bdate_range("2018-01-01", periods=days)
    return pd.Series(prices, index=idx, name="SYN")


class TestBacktestHelpers:
    def test_param_grid_nonempty_and_ordered(self):
        grid = default_param_grid()
        assert len(grid) > 20
        for p in grid:
            assert p["n_short"] < p["n_long"]
            assert p["fast_short"] < p["slow_short"]

    def test_split_ratio(self):
        close = _synth_close(400)
        train, test = split_train_test(close, 0.6)
        assert len(train) == 240
        assert len(test) == 160

    def test_compute_metrics_buyhold_positive_drift(self):
        close = _synth_close(400, drift=0.002, seed=1)
        rets = close.pct_change().fillna(0).to_numpy()
        m = compute_metrics(rets, position=np.ones(len(rets)))
        assert m.bars == 400
        assert m.total_return > 0
        assert m.sharpe > 0

    def test_metrics_for_close_modes(self):
        close = _synth_close(300, seed=2)
        p = production_params()
        cross = metrics_for_close(close, p, mode="cross")
        regime = metrics_for_close(close, p, mode="regime")
        bh = metrics_for_close(close, p, mode="buyhold")
        assert cross.bars == regime.bars == bh.bars == 300
        assert bh.trades_per_year == 0.0 or bh.trades <= 1


class TestValidateTickerOffline:
    def test_validate_returns_is_oos_metrics(self):
        close = _synth_close(600, drift=0.0009, seed=3)
        # Tiny grid for speed
        grid = [
            {
                "n_short": 10,
                "fast_short": 2,
                "slow_short": 30,
                "n_long": 30,
                "fast_long": 2,
                "slow_long": 30,
            },
            {
                "n_short": 12,
                "fast_short": 2,
                "slow_short": 30,
                "n_long": 40,
                "fast_long": 2,
                "slow_long": 30,
            },
            {
                "n_short": 15,
                "fast_short": 3,
                "slow_short": 20,
                "n_long": 50,
                "fast_long": 3,
                "slow_long": 40,
            },
        ]
        result = validate_ticker("SYN", close, grid=grid)
        assert result.train_bars + result.test_bars == 600
        assert "buyhold_is" in result.metrics
        assert "buyhold_oos" in result.metrics
        assert "production_regime_oos" in result.metrics
        assert result.n_grid >= 1
