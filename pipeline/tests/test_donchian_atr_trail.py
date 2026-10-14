"""Unit tests for ATR chandelier trail helpers."""
from pipeline.research.donchian_vwap_backtest import _init_trail, _update_trail


def test_trail_ratchets_up_only():
    s = _init_trail(entry=100.0, atr=2.0, mult=2.5)
    assert s.stop_price == 95.0
    s2 = _update_trail(s, high=110.0, atr=2.0, mult=2.5)
    assert s2.peak_price == 110.0
    assert s2.stop_price == 105.0
    s3 = _update_trail(s2, high=108.0, atr=2.0, mult=2.5)
    assert s3.stop_price == 105.0
