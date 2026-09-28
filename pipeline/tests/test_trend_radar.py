"""Unit tests for the module-1 watchlist screener."""
import pandas as pd
import pytest

from pipeline.compute.trend_radar import (
    HOT_MIN_DAY_PCT,
    HOT_MIN_REL_VOLUME,
    MIN_HISTORY_DAYS,
    WATCH_MIN_DAY_PCT,
    WATCH_MIN_REL_VOLUME,
    day_percent_change,
    on_watchlist,
    process_ticker,
    relative_volume,
    watch_rank,
)


def _frame(closes, highs, volumes) -> pd.DataFrame:
    n = len(closes)
    return pd.DataFrame({
        "date": pd.date_range("2024-01-01", periods=n),
        "open": closes,
        "high": highs,
        "low": [c * 0.99 for c in closes],
        "close": closes,
        "volume": volumes,
    })


class TestRelativeVolume:
    def test_excludes_today_from_average(self):
        volume = pd.Series([100.0] * 50 + [500.0])
        assert relative_volume(volume, 50) == pytest.approx(5.0)

    def test_short_history_is_zero(self):
        assert relative_volume(pd.Series([100.0] * 10), 50) == 0.0


class TestDayChange:
    def test_percent_points(self):
        close = pd.Series([100.0, 110.0])
        assert day_percent_change(close) == pytest.approx(10.0)


class TestWatchRank:
    def test_on_list_outranks_ordinary_up_day(self):
        listed = watch_rank(True, -1.0, 6.0)
        ordinary = watch_rank(False, 0.0, 3.0)
        assert listed >= 70
        assert ordinary < listed

    def test_closer_to_high_ranks_higher_on_the_list(self):
        at_high = watch_rank(True, 0.0, 8.0)
        off_high = watch_rank(True, -4.0, 8.0)
        assert at_high > off_high


class TestProcessTicker:
    def test_insufficient_data_returns_none(self):
        df = _frame([100.0] * 40, [101.0] * 40, [1_000_000.0] * 40)
        assert process_ticker(df) is None

    def test_hot_name_clears_five_times_volume_and_ten_percent(self):
        n = MIN_HISTORY_DAYS
        closes = [100.0] * (n - 1) + [112.0]
        highs = [101.0] * (n - 1) + [112.0]
        volumes = [1_000_000.0] * (n - 1) + [6_000_000.0]
        result = process_ticker(_frame(closes, highs, volumes))
        assert result is not None
        assert result["state"] == 1
        assert result["entry_timing"] == "hot"
        assert result["volume_confirmed"] is True
        assert result["breakout_active"] is True
        assert result["z_mom"] == pytest.approx(12.0)
        assert result["f_ewmac"] == pytest.approx(6.0)
        assert result["quality_rank"] >= 70
        assert result["kama_regime"] == 0

    def test_watch_name_is_on_list_but_not_hot(self):
        n = MIN_HISTORY_DAYS
        closes = [100.0] * (n - 1) + [105.0]
        highs = [101.0] * (n - 1) + [108.0]  # about 2.8% off the high
        volumes = [1_000_000.0] * (n - 1) + [3_000_000.0]
        result = process_ticker(_frame(closes, highs, volumes))
        assert result is not None
        assert result["entry_timing"] == "watch"
        assert result["state"] == 1
        assert result["volume_confirmed"] is False
        assert result["breakout_active"] is False
        assert result["convergence_count"] == 2

    def test_down_day_is_off_the_list(self):
        n = MIN_HISTORY_DAYS
        closes = [100.0] * (n - 1) + [97.0]
        highs = [101.0] * n
        volumes = [1_000_000.0] * n
        result = process_ticker(_frame(closes, highs, volumes))
        assert result is not None
        assert result["state"] == -1
        assert result["entry_timing"] == "off"
        assert on_watchlist(result["z_mom"], result["f_ewmac"]) is False

    def test_thresholds_match_watchlist_contract(self):
        assert WATCH_MIN_DAY_PCT == 4.0
        assert WATCH_MIN_REL_VOLUME == 2.0
        assert HOT_MIN_DAY_PCT == 10.0
        assert HOT_MIN_REL_VOLUME == 5.0
        assert MIN_HISTORY_DAYS == 51
