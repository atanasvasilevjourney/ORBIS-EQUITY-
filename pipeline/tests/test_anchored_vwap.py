from datetime import date

import pandas as pd

from pipeline.research.anchored_vwap import (
    anchored_vwap_on_day,
    anchored_vwap_series,
    lowest_low_anchor_day,
)


def _panel() -> pd.DataFrame:
    idx = pd.date_range("2024-01-02", periods=6, freq="B")
    return pd.DataFrame(
        {
            "open": [10, 11, 12, 13, 14, 15],
            "high": [10.5, 11.5, 12.5, 13.5, 14.5, 15.5],
            "low": [9.5, 10.5, 11.5, 12.5, 13.5, 14.5],
            "close": [10, 11, 12, 13, 14, 15],
            "volume": [100, 200, 100, 200, 100, 200],
        },
        index=idx,
    )


def test_anchored_vwap_accumulates_from_anchor():
    ohlcv = _panel()
    anchor = date(2024, 1, 4)
    s = anchored_vwap_series(ohlcv, anchor)
    v1 = float(s.iloc[2])  # first anchor bar
    v2 = float(s.iloc[3])
    assert v1 > 0
    assert v2 > v1  # more volume-weighted history


def test_lowest_low_anchor_prefers_minimum_low():
    ohlcv = _panel()
    ohlcv.iloc[1, ohlcv.columns.get_loc("low")] = 5.0
    d = date(2024, 1, 9)
    anchor = lowest_low_anchor_day(ohlcv, d, lookback=5)
    assert anchor == date(2024, 1, 3)


def test_anchored_vwap_on_day_matches_series_tail():
    ohlcv = _panel()
    anchor = date(2024, 1, 2)
    d = date(2024, 1, 5)
    assert anchored_vwap_on_day(ohlcv, anchor, d) == anchored_vwap_on_day(ohlcv, anchor, d)