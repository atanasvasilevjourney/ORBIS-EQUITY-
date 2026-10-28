"""Tests for SMA20 trail + cooldown."""
import numpy as np

from pipeline.compute.loop_xs_selection import xs_trail_exit
from pipeline.compute.trail_exit import CooldownTracker, TrailState, replay_wide_stop


def test_trail_moves_to_breakeven_then_sma():
    trail = TrailState(entry_price=100.0, current_sl=95.0, peak_price=100.0)
    # +4% → BE
    sl = trail.update(high=104.5, close=104.0, sma20=101.0)
    assert trail.be_active
    assert sl >= 100.0
    # Further run → trail uses max(peak*-7%, sma20)
    sl2 = trail.update(high=112.0, close=111.0, sma20=105.0)
    assert trail.trail_active
    assert sl2 >= 105.0
    # After +10%, SMA20 only floor still ratchets
    sl3 = trail.update(high=115.0, close=114.0, sma20=108.0)
    assert sl3 >= 108.0


def test_cooldown_skips_after_two_losses():
    cd = CooldownTracker()
    assert cd.on_entry_attempt()
    cd.on_exit(-1.0)
    assert cd.on_entry_attempt()
    cd.on_exit(-2.0)
    # Now skip next
    assert not cd.on_entry_attempt()
    # Subsequent allowed
    assert cd.on_entry_attempt()


def test_replay_exits_a_giveback_and_ignores_a_red_day_before_the_trail():
    climb = np.linspace(100.0, 130.0, 30)
    closes = np.concatenate([climb, [128.0, 90.0]])
    highs = closes.copy()
    sma = np.concatenate([np.full(19, np.nan), np.convolve(closes, np.ones(20) / 20, mode="valid")])
    # A single down close while the trail is still inactive does not arm a stop.
    early_stop = replay_wide_stop(100.0, [101.0], [99.0], [np.nan])
    assert xs_trail_exit(99.0, early_stop) is None
    stop = replay_wide_stop(100.0, highs[:-1], closes[:-1], sma[:-1])
    assert stop > 100.0
    assert xs_trail_exit(float(closes[-2]), stop) is None
    crashed = replay_wide_stop(100.0, highs, closes, sma)
    assert xs_trail_exit(float(closes[-1]), crashed) is not None


def test_cooldown_resets_on_win():
    cd = CooldownTracker()
    cd.on_exit(-1.0)
    cd.on_exit(2.0)
    assert cd.consecutive_losses == 0
    assert not cd.skip_next
