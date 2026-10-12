from pipeline.ema200_scanner.watchlist import classify_setup


def test_retrace_held_passes():
    row = {
        "symbol": "AMZN",
        "dist_atr": 0.3,
        "close": 250.0,
        "ema200": 248.0,
        "days_above": 25,
        "ema200_slope": 0.001,
    }
    assert classify_setup(row) == "RETRACE_HELD"


def test_far_from_ema_rejected():
    row = {
        "dist_atr": 3.0,
        "close": 300,
        "ema200": 250,
        "days_above": 30,
        "ema200_slope": 0.01,
    }
    assert classify_setup(row) is None


def test_breakdown_below_ema_rejected():
    row = {
        "dist_atr": -0.2,
        "close": 240,
        "ema200": 250,
        "days_above": 30,
        "ema200_slope": 0.01,
    }
    assert classify_setup(row) is None
