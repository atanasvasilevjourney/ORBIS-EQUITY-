"""Desk location validation: VWAP parity, watchlist parity, 5-minute fills."""
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from pipeline.research.desk_location import (
    add_session_week_vwap,
    build_daily_trades,
    daily_desk_frame,
    production_row_matches_process_ticker,
    simulate_intraday,
)


def _bar(ts: datetime, close: float, vol: float) -> dict:
    return {
        "open": close,
        "high": close + 1,
        "low": close - 1,
        "close": close,
        "volume": vol,
        "time": ts,
    }


def test_session_vwap_resets_on_new_et_day():
    rows = [
        _bar(datetime(2024, 6, 3, 14, 0, tzinfo=timezone.utc), 100, 1000),
        _bar(datetime(2024, 6, 3, 14, 5, tzinfo=timezone.utc), 102, 1000),
        _bar(datetime(2024, 6, 4, 14, 0, tzinfo=timezone.utc), 90, 500),
    ]
    df = pd.DataFrame(rows).set_index("time")
    out = add_session_week_vwap(df)
    assert out["vwap_session"].iloc[0] == 100
    assert abs(out["vwap_session"].iloc[1] - 101) < 1e-9
    assert out["vwap_session"].iloc[2] == 90


def test_week_avwap_carries_across_et_sessions():
    rows = [
        _bar(datetime(2024, 6, 4, 14, 0, tzinfo=timezone.utc), 100, 100),
        _bar(datetime(2024, 6, 5, 14, 0, tzinfo=timezone.utc), 110, 100),
    ]
    df = pd.DataFrame(rows).set_index("time")
    out = add_session_week_vwap(df)
    assert abs(out["vwap_week"].iloc[1] - 105) < 1e-9
    assert out["vwap_session"].iloc[1] == 110


def test_vectorized_watchlist_matches_process_ticker():
    n = 80
    idx = pd.bdate_range("2024-01-01", periods=n)
    close = np.linspace(100, 130, n)
    close[-1] = close[-2] * 1.12
    volume = np.full(n, 1_000_000.0)
    volume[-1] = 6_000_000.0
    df = pd.DataFrame(
        {
            "open": close,
            "high": close * 1.01,
            "low": close * 0.99,
            "close": close,
            "volume": volume,
        },
        index=idx,
    )
    assert production_row_matches_process_ticker(df)
    last = daily_desk_frame(df).iloc[-1]
    assert bool(last["hot"])
    assert int(last["quality_rank"]) >= 70


def test_long_retest_fills_next_open_and_stops_under_the_line():
    # One session. Bar 1 closes above VWAP, bar 2 retests, bar 3 is the fill,
    # bar 4 closes back through the line, bar 5 open is the exit.
    idx = pd.date_range("2024-06-03 14:00", periods=6, freq="5min", tz="UTC")
    rows = [
        (100, 101, 99, 100, 100),
        (100, 102, 100, 102, 100),
        (102, 103, 100.2, 101, 100),
        (101, 103, 100.8, 102, 100),
        (102, 102, 99, 100, 100),
        (100, 101, 99, 100, 100),
    ]
    df = pd.DataFrame(rows, columns=["open", "high", "low", "close", "volume"], index=idx)
    trades = simulate_intraday(
        df,
        np.ones(len(df), dtype=bool),
        np.zeros(len(df), dtype=bool),
        symbol="TEST",
        variant="location",
    )
    assert len(trades) == 1
    tr = trades[0]
    assert tr["side"] == "long"
    assert tr["entry_price"] == 101
    assert tr["exit_price"] == 100
    assert tr["exit_reason"] == "line"
    assert tr["return_pct"] < 0


def test_failed_break_does_not_enter():
    idx = pd.date_range("2024-06-03 14:00", periods=4, freq="5min", tz="UTC")
    rows = [
        (100, 101, 99, 100, 100),
        (100, 102, 100, 102, 100),
        (102, 102, 99, 99, 100),
        (99, 100, 98, 99, 100),
    ]
    df = pd.DataFrame(rows, columns=["open", "high", "low", "close", "volume"], index=idx)
    trades = simulate_intraday(
        df,
        np.ones(len(df), dtype=bool),
        np.zeros(len(df), dtype=bool),
        symbol="TEST",
        variant="location",
    )
    assert trades == []


def test_daily_entry_is_the_next_open():
    idx = pd.bdate_range("2024-01-02", periods=10)
    close = np.array([100, 101, 102, 103, 104, 105, 106, 107, 108, 109], dtype=float)
    df = pd.DataFrame(
        {
            "open": close - 0.5,
            "high": close + 1,
            "low": close - 1,
            "close": close,
            "volume": 1_000_000.0,
            "ema200": close - 5,
            "on_list": [False, True] + [False] * 8,
        },
        index=idx,
    )
    trades = build_daily_trades("ABC", df, df["on_list"], hold=3, stop_on_ribbon=False, signal_start="2020-01-01")
    assert len(trades) == 1
    assert trades[0]["signal_date"] == str(idx[1].date())
    assert trades[0]["entry_date"] == str(idx[2].date())
    assert trades[0]["entry_price"] == close[2] - 0.5
    assert trades[0]["bars_held"] == 3
