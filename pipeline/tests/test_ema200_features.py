"""Feature pipeline correctness — no lookahead on historical rows."""
import pandas as pd

from pipeline.ema200_scanner.indicators.features import compute_features_frame


def test_truncated_history_matches_full_series():
    n = 650
    idx = pd.date_range("2021-01-04", periods=n, freq="B")
    close = pd.Series(range(100, 100 + n), index=idx, dtype=float)
    df = pd.DataFrame(
        {
            "open": close,
            "high": close + 2,
            "low": close - 2,
            "close": close,
            "volume": 1_000_000,
        }
    )
    cut = 620
    partial = df.iloc[:cut]
    full = compute_features_frame(
        df,
        ema_period=200,
        atr_period=14,
        history_min_bars=500,
        slope_lookback=20,
        regime="bull",
    )
    part = compute_features_frame(
        partial,
        ema_period=200,
        atr_period=14,
        history_min_bars=500,
        slope_lookback=20,
        regime="bull",
    )
    compare_idx = partial.index[-1]
    cols = ["close", "ema200", "ema200_slope", "atr14", "dist_atr", "rvol", "days_above"]
    for col in cols:
        assert full.loc[compare_idx, col] == part.loc[compare_idx, col]
