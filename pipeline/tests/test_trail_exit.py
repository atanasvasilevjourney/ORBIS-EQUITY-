"""Tests for SMA20 trail + cooldown."""
from pipeline.compute.trail_exit import CooldownTracker, TrailState


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


def test_cooldown_resets_on_win():
    cd = CooldownTracker()
    cd.on_exit(-1.0)
    cd.on_exit(2.0)
    assert cd.consecutive_losses == 0
    assert not cd.skip_next
