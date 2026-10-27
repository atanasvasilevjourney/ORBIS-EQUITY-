from datetime import date

import numpy as np
import pytest
import pandas as pd

from pipeline.compute.relative_strength import (
    RS_LOOKBACK,
    percentile_ranks,
    rs_percentiles_from_frames,
    trailing_total_return,
)


def test_trailing_return_uses_lookback_start():
    close = pd.Series([100.0, 110.0, 121.0])
    assert trailing_total_return(close, lookback=2) == pytest.approx(0.21)


def test_trailing_return_rejects_short_or_nonpositive_history():
    assert trailing_total_return(pd.Series([100.0, 110.0]), lookback=5) is None
    assert trailing_total_return(pd.Series([0.0, 1.0, 2.0]), lookback=2) is None


def test_percentile_ranks_put_the_leader_at_100():
    ranks = percentile_ranks({"A": 0.01, "B": 0.05, "C": 0.20})
    assert ranks == {"A": 0.0, "B": 50.0, "C": 100.0}


def test_ties_share_the_average_percentile():
    ranks = percentile_ranks({"A": 0.01, "B": 0.20, "C": 0.20})
    assert ranks["A"] == 0.0
    assert ranks["B"] == ranks["C"] == 75.0


def test_single_name_has_no_peer_percentile():
    assert percentile_ranks({"AAPL": 0.12}) == {"AAPL": 50.0}


def test_rs_ignores_bars_after_as_of():
    idx = pd.bdate_range("2024-01-02", periods=RS_LOOKBACK + 5)
    up = pd.DataFrame({"date": idx, "close": np.linspace(100, 170, len(idx))})
    crash_date = idx[-1] + pd.Timedelta(days=5)
    crashed = pd.concat(
        [up, pd.DataFrame({"date": [crash_date], "close": [10.0]})],
        ignore_index=True,
    )
    as_of = idx[-1].date()
    cut = rs_percentiles_from_frames(
        {"AAA": crashed, "BBB": up},
        as_of=as_of,
    )
    full = rs_percentiles_from_frames({"AAA": crashed, "BBB": up}, as_of=None)
    assert cut["AAA"] == cut["BBB"]
    assert full["AAA"] < full["BBB"]
    assert isinstance(as_of, date)
