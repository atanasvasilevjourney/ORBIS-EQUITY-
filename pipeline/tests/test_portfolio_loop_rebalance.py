"""Rebalance invariants for portfolio_loop (no flatten on empty target)."""

from pathlib import Path


def test_prices_loaded_via_fetch_all_helper():
    text = Path("pipeline/compute/portfolio_loop.py").read_text(encoding="utf-8")
    assert "fetch_all(" in text
    assert 'order=("symbol", False)' in text
    assert "range(offset, offset + page - 1)" not in text


def test_atr_trail_exit_wired():
    text = Path("pipeline/compute/portfolio_loop.py").read_text(encoding="utf-8")
    assert "atr_trail_exit_signal" in text
    assert "LOOP_ATR_PERIOD" in text
    assert "LOOP_ATR_MULT" in text


def test_empty_target_does_not_rotate_out_held():
    text = Path("pipeline/compute/portfolio_loop.py").read_text(encoding="utf-8")
    assert "if target_syms:" in text
    assert "Rebalance skipped rotate-out" in text
    # rotate-out loop must be nested under target_syms guard
    idx = text.index("Rebalance target:")
    rotate = text.index("Rebalance · dropped from top basket")
    guard = text.rfind("if target_syms:", 0, rotate)
    assert guard > idx, "rotate-out should be guarded by non-empty target_syms"
