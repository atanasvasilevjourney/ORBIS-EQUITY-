"""Watchlist backtest selection: next session only, closest to the high first."""
from datetime import date

import pandas as pd

from pipeline.research.watchlist_backtest import portfolio_returns, select_book, signal_frame


def _ohlcv(closes, highs, volumes, opens=None) -> pd.DataFrame:
    n = len(closes)
    idx = pd.bdate_range("2024-01-02", periods=n)
    return pd.DataFrame(
        {
            "open": opens if opens is not None else closes,
            "high": highs,
            "low": [c * 0.99 for c in closes],
            "close": closes,
            "volume": volumes,
        },
        index=idx,
    )


def test_signal_flags_hot_day_and_shifts_return_forward():
    n = 60
    closes = [100.0] * (n - 1) + [112.0]
    highs = [101.0] * (n - 1) + [112.0]
    volumes = [1_000_000.0] * (n - 1) + [6_000_000.0]
    # one extra bar so the signal day has a next session
    closes.append(110.0)
    highs.append(113.0)
    volumes.append(1_000_000.0)
    closes.append(109.0)
    highs.append(111.0)
    volumes.append(1_000_000.0)
    opens = [100.0] * n + [111.0, 110.0]
    sig = signal_frame(_ohlcv(closes, highs, volumes, opens))
    row = sig.iloc[-1]
    spike = sig.iloc[-2]
    assert bool(spike["on_list"])
    assert bool(spike["hot"])
    assert spike["day_pct"] == pytest_approx(12.0)
    assert spike["rel_vol"] == pytest_approx(6.0)
    # next open 111, next close 110
    assert spike["next_oc"] == pytest_approx(110.0 / 111.0 - 1.0)
    assert not bool(row["hot"])


def test_book_keeps_name_closer_to_the_high():
    day = pd.Timestamp("2024-06-03")
    signals = pd.DataFrame(
        [
            {"date": day, "symbol": "FAR", "off_high": -6.0, "day_pct": 8.0, "on_list": True, "hot": False, "next_oc": 0.02, "exit_date": day + pd.Timedelta(days=1)},
            {"date": day, "symbol": "NEAR", "off_high": -0.2, "day_pct": 5.0, "on_list": True, "hot": False, "next_oc": -0.01, "exit_date": day + pd.Timedelta(days=1)},
            {"date": day, "symbol": "OFF", "off_high": -0.1, "day_pct": 12.0, "on_list": False, "hot": False, "next_oc": 0.05, "exit_date": day + pd.Timedelta(days=1)},
        ]
    )
    book = select_book(signals, hot_only=False, top_n=1)
    assert list(book["symbol"]) == ["NEAR"]


def test_empty_list_is_cash():
    cal = pd.bdate_range("2024-06-03", periods=3)
    rets = portfolio_returns(pd.DataFrame(), cal)
    assert (rets == 0).all()
    assert len(rets) == 3


def pytest_approx(value: float, rel: float = 1e-6):
    import pytest
    return pytest.approx(value, rel=rel)
