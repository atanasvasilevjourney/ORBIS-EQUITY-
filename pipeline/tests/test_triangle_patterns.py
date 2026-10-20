import pandas as pd

from pipeline.triangle_scanner.patterns.triangles import detect_triangle, swing_points


def _crafted_ascending(n: int = 65) -> pd.DataFrame:
    high = [55.0] * n
    low = [50.0] * n
    close = [52.0] * n
    for peak_i in [15, 27, 39, 51]:
        for d in (-1, 0, 1):
            high[peak_i + d] = 100.0
    for j, li in enumerate([10, 22, 34, 46]):
        val = 80 + j * 2
        for d in (-2, -1, 0, 1, 2):
            low[li + d] = val + abs(d) * 1.5
        close[li] = val + 0.5
    close[-1] = 101.5
    high[-1] = 102
    low[-1] = 94
    return pd.DataFrame(
        {
            "date": pd.date_range("2024-01-01", periods=n),
            "open": close,
            "high": high,
            "low": low,
            "close": close,
            "volume": [1_000_000] * n,
        }
    )


def _crafted_descending(n: int = 65) -> pd.DataFrame:
    high = [60.0] * n
    low = [95.0] * n
    close = [97.0] * n
    for j, li in enumerate([10, 22, 34, 46]):
        ceiling = 112.0 - j * 2
        for d in (-1, 0, 1):
            high[li + d] = ceiling
        close[li] = ceiling - 0.5
        for d in (-1, 0, 1):
            low[li + d] = 90.0
    close[-1] = 109.0
    high[-1] = 110
    low[-1] = 89
    return pd.DataFrame(
        {
            "date": pd.date_range("2024-01-01", periods=n),
            "open": close,
            "high": high,
            "low": low,
            "close": close,
            "volume": [1_000_000] * n,
        }
    )


CFG = {
    "lookback_bars": 60,
    "swing_order": 2,
    "min_swing_points": 2,
    "flat_tolerance_pct": 3.0,
    "min_slope_pct_per_bar": 0.01,
    "max_slope_pct_per_bar": 10.0,
    "breakout_buffer_pct": 0.05,
}


def test_swing_points_finds_peaks():
    s = pd.Series([1, 2, 5, 2, 1, 3, 6, 2])
    pts = swing_points(s, 1, "high")
    assert any(p == 5 for _, p in pts)
    assert any(p == 6 for _, p in pts)


def test_ascending_triangle_on_crafted_bars():
    hit = detect_triangle(_crafted_ascending(), "ascending", CFG)
    assert hit is not None
    assert hit["pattern_type"] == "ascending"
    assert hit["status"] in ("forming", "breakout_up")


def test_descending_triangle_on_crafted_bars():
    hit = detect_triangle(_crafted_descending(), "descending", CFG)
    assert hit is not None
    assert hit["pattern_type"] == "descending"
    assert "geometry" in hit
