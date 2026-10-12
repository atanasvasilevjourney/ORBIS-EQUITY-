import pandas as pd

from pipeline.compute.donchian_vwap import ENTRY_CHANNEL, latest_snapshot, prior_bar_snapshot


def _ohlcv(closes: list[float]) -> pd.DataFrame:
    n = len(closes)
    return pd.DataFrame(
        {
            "date": pd.date_range("2024-01-01", periods=n, freq="B"),
            "high": [c * 1.01 for c in closes],
            "low": [c * 0.99 for c in closes],
            "close": closes,
            "volume": [1_000_000] * n,
        }
    )


def test_latest_snapshot_requires_history():
    df = _ohlcv([100.0] * (ENTRY_CHANNEL + 1))
    assert latest_snapshot(df) is None


def test_breakout_eligible_on_monotone_rise():
    n = ENTRY_CHANNEL + 5
    closes = [100 + i * 0.5 for i in range(n)]
    df = _ohlcv(closes)
    snap = latest_snapshot(df)
    assert snap is not None
    assert snap["above_vwap"] is True
    assert snap["strength"] >= 0


def test_prior_bar_is_one_day_back():
    n = ENTRY_CHANNEL + 5
    closes = [100 + i * 0.5 for i in range(n)]
    df = _ohlcv(closes)
    assert prior_bar_snapshot(df) is not None
