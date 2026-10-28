from datetime import date

import numpy as np
import pytest
import pandas as pd

from pipeline.compute.relative_strength import (
    RS_LOOKBACK,
    percentile_ranks,
    rs_percentiles_from_frames,
    trailing_total_return,
    window_return,
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


def _path(end: float, n: int = 70) -> pd.DataFrame:
    idx = pd.bdate_range("2024-01-02", periods=n)
    return pd.DataFrame({"date": idx, "close": np.linspace(100.0, end, n)})


def test_sector_residual_ranks_the_sector_leader_ahead_of_raw_beta():
    frames = {
        "TECH1": _path(180),
        "TECH2": _path(170),
        "EN1": _path(140),
        "EN2": _path(110),
    }
    sectors = {"TECH1": "Tech", "TECH2": "Tech", "EN1": "Energy", "EN2": "Energy"}
    raw = rs_percentiles_from_frames(frames, lookback=63)
    residual = rs_percentiles_from_frames(frames, lookback=63, sectors=sectors)
    assert raw["TECH1"] == 100.0
    assert residual["EN1"] > residual["TECH1"]


def test_spy_excess_preserves_rank_on_a_shared_calendar():
    frames = {"AAA": _path(180), "BBB": _path(150)}
    raw = rs_percentiles_from_frames(frames, lookback=63)
    excess = rs_percentiles_from_frames(frames, lookback=63, benchmark=_path(130))
    assert excess == raw


def test_skip_recent_ignores_a_trailing_crash():
    idx = pd.bdate_range("2024-01-02", periods=90)
    base = np.linspace(100.0, 160.0, len(idx))
    crashed = base.copy()
    crashed[-10:] = np.linspace(base[-11], 40.0, 10)
    calm = pd.DataFrame({"date": idx, "close": base})
    wreck = pd.DataFrame({"date": idx, "close": crashed})
    skipped = rs_percentiles_from_frames(
        {"AAA": wreck, "BBB": calm},
        lookback=63,
        skip_recent=21,
    )
    live = rs_percentiles_from_frames({"AAA": wreck, "BBB": calm}, lookback=63, skip_recent=0)
    assert skipped["AAA"] == skipped["BBB"]
    assert live["AAA"] < live["BBB"]
    assert window_return(pd.Series(base), 63, 21) == pytest.approx(
        window_return(pd.Series(crashed), 63, 21)
    )


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
