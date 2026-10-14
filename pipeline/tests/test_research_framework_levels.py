import numpy as np

from pipeline.research_framework.levels import long_setup_from_bars


def test_long_setup_breakout_prior_high():
    n = 30
    close = np.linspace(100, 110, n)
    high = close + 1
    low = close - 1
    out = long_setup_from_bars(high, low, close, entry_mode="breakout_prior_high")
    assert out is not None
    assert out["entry_px"] == out["last_px"] - 1 or out["entry_px"] >= 100
    assert out["stop_px"] < out["entry_px"] < out["target_px"]
    assert out["rr"] > 0
