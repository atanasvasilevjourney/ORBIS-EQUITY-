"""Shared pytest fixtures for pipeline tests."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest


@pytest.fixture
def uptrend_prices() -> pd.Series:
    """Monotonically rising price series (200 days) for bullish signal tests."""
    days = 200
    base = 100.0
    returns = np.random.default_rng(42).normal(0.002, 0.01, days)
    prices = base * np.cumprod(1 + returns)
    return pd.Series(prices)


@pytest.fixture
def downtrend_prices() -> pd.Series:
    """Monotonically falling price series (200 days) for bearish signal tests."""
    days = 200
    base = 100.0
    returns = np.random.default_rng(99).normal(-0.002, 0.01, days)
    prices = base * np.cumprod(1 + returns)
    return pd.Series(prices)


@pytest.fixture
def flat_prices() -> pd.Series:
    """Flat price series with minimal variation."""
    return pd.Series([100.0] * 200)


@pytest.fixture
def price_ohlcv_df() -> pd.DataFrame:
    """Full OHLCV dataframe with enough history for process_ticker (>=148 days)."""
    days = 200
    rng = np.random.default_rng(7)
    dates = [date.today() - timedelta(days=days - i) for i in range(days)]
    close = 100.0 * np.cumprod(1 + rng.normal(0.001, 0.015, days))
    high = close * (1 + rng.uniform(0, 0.02, days))
    low = close * (1 - rng.uniform(0, 0.02, days))
    open_ = close * (1 + rng.uniform(-0.01, 0.01, days))
    volume = rng.integers(500_000, 2_000_000, days).astype(float)

    return pd.DataFrame({
        "date": dates,
        "open": open_,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
    })


@pytest.fixture
def strong_f_score_data() -> dict:
    """Financial report fixtures that should yield a high Piotroski F-Score."""
    income_cur = {
        "netIncome": 1000,
        "grossProfit": 5000,
        "revenue": 10000,
        "weightedAverageShsOutDil": 100,
    }
    income_pri = {
        "netIncome": 500,
        "grossProfit": 4000,
        "revenue": 9000,
        "weightedAverageShsOutDil": 110,
    }
    balance_cur = {
        "totalAssets": 20000,
        "longTermDebt": 3000,
        "totalCurrentAssets": 5000,
        "totalCurrentLiabilities": 2000,
    }
    balance_pri = {
        "totalAssets": 18000,
        "longTermDebt": 4000,
        "totalCurrentAssets": 4000,
        "totalCurrentLiabilities": 2000,
    }
    cashflow_cur = {"operatingCashFlow": 1500}
    return {
        "income_cur": income_cur,
        "income_pri": income_pri,
        "balance_cur": balance_cur,
        "balance_pri": balance_pri,
        "cashflow_cur": cashflow_cur,
    }


@pytest.fixture
def weak_f_score_data() -> dict:
    """Financial report fixtures that should yield a low Piotroski F-Score."""
    income_cur = {
        "netIncome": -500,
        "grossProfit": 2000,
        "revenue": 10000,
        "weightedAverageShsOutDil": 120,
    }
    income_pri = {
        "netIncome": 500,
        "grossProfit": 3000,
        "revenue": 9000,
        "weightedAverageShsOutDil": 100,
    }
    balance_cur = {
        "totalAssets": 20000,
        "longTermDebt": 6000,
        "totalCurrentAssets": 3000,
        "totalCurrentLiabilities": 3000,
    }
    balance_pri = {
        "totalAssets": 18000,
        "longTermDebt": 4000,
        "totalCurrentAssets": 4000,
        "totalCurrentLiabilities": 2000,
    }
    cashflow_cur = {"operatingCashFlow": -200}
    return {
        "income_cur": income_cur,
        "income_pri": income_pri,
        "balance_cur": balance_cur,
        "balance_pri": balance_pri,
        "cashflow_cur": cashflow_cur,
    }
