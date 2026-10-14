"""Double EMA200 ribbon — reference bar MA 2026-09-30 (user calibration)."""
import pytest

from pipeline.ema200_scanner.watchlist import classify_setup

# Yahoo-adjusted EOD recompute (Pine-style EMA200 on close & high).
MA_2026_09_29 = {
    "symbol": "MA",
    "close": 562.73,
    "ema200": 539.46,
    "ema200_high": 544.40,
    "dist_atr": 2.733,
    "ribbon_dist_atr": 2.15,
    "days_above": 57,
    "ema200_slope": 0.01224,
}

MA_2026_09_30 = {
    "symbol": "MA",
    "close": 550.64,
    "ema200": 539.57,
    "ema200_high": 544.57,
    "dist_atr": 1.231,
    "ribbon_dist_atr": 0.67,
    "days_above": 58,
    "ema200_slope": 0.011556,
}


def test_ma_sept_30_reference_on_watchlist():
    assert classify_setup(MA_2026_09_30) == "RETRACE_HELD"


def test_ma_sept_29_too_extended_for_ribbon():
    assert classify_setup(MA_2026_09_29) is None


@pytest.mark.parametrize(
    "ribbon_dist,expect",
    [(0.0, "RETRACE_HELD"), (1.5, "RETRACE_HELD"), (1.51, None)],
)
def test_ribbon_dist_threshold(ribbon_dist, expect):
    row = {**MA_2026_09_30, "ribbon_dist_atr": ribbon_dist}
    assert classify_setup(row) == expect
