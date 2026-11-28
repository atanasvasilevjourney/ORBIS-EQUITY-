"""Fill-rule accounting and production LOOP alignment tests."""
from __future__ import annotations

from datetime import date

import pandas as pd

from pipeline.compute.loop_atr_trail import chandelier_trail_snapshot
from pipeline.compute.loop_order_economics import next_session_date
from pipeline.research.donchian_vwap_backtest import run_donchian_vwap_portfolio
from pipeline.strategies.fill_rules import gap_stop_return, portfolio_pnl_day


def _panel(days, opens, highs, lows, closes):
    return pd.DataFrame(
        {"open": opens, "high": highs, "low": lows, "close": closes, "volume": 1_000_000},
        index=pd.DatetimeIndex(days),
    )


def test_gap_through_stop_books_open_loss():
    days = pd.bdate_range("2026-04-01", periods=4)
    # stop ~100; gap open at 90
    ohlcv = _panel(days, [100, 100, 90, 92], [102, 102, 91, 93], [98, 98, 89, 91], [100, 100, 91, 92])
    r = gap_stop_return(ohlcv, days[2].date())
    assert r is not None
    assert r < -0.05


def test_exit_day_stop_includes_close_to_close_loss():
    days = pd.bdate_range("2026-05-01", periods=6)
    spy = _panel(days, [100] * 6, [100] * 6, [100] * 6, [100] * 6)
    # Big down day when stop fires
    closes = [100, 102, 104, 106, 90, 89]
    aaa = _panel(days, closes, closes, closes, closes)
    sig = pd.DataFrame(
        {
            "eligible": [True] * 6,
            "exit_signal": [False, False, False, False, True, False],
            "strength": [1.0] * 6,
        },
        index=days,
    )
    daily, _ = run_donchian_vwap_portfolio(
        days[0].date(),
        days[-1].date(),
        panels={"SPY": spy, "AAA": aaa},
        signals={"AAA": sig},
        sym_sector={"AAA": "Technology"},
        exit_mode="donchian20",
        rebalance_weekday=None,
    )
    # Day 4 is >15% drop — must appear in portfolio return if still held
    # 1/8 slot weight scales the name's -15% day
    assert float(daily.iloc[4]) < -0.01


def test_no_releverage_slot_weight_on_partial_book():
    days = pd.bdate_range("2026-06-01", periods=3)
    panels = {
        "SPY": _panel(days, [100, 100, 100], [100, 100, 100], [100, 100, 100], [100, 100, 100]),
        "AAA": _panel(days, [100, 100, 110], [100, 100, 110], [100, 100, 110], [100, 100, 110]),
    }
    d2 = days[2].date()
    ret, legs = portfolio_pnl_day(
        panels,
        d2,
        start_symbols=["AAA"],
        end_symbols=["AAA"],
        stop_close_exits=[],
        stop_gap_exits=[],
        rotated_out=[],
        new_entries=[],
        top_n=8,
        cost=None,
    )
    # Only 1/8 weight → ~1.25% on +10% day, not 10%
    assert legs[0].weight == 0.125
    assert 0.01 < ret < 0.02


def test_same_bar_entry_uses_prior_signal_day():
    days = pd.bdate_range("2026-03-02", periods=10)
    spy = _panel(days, [100] * 10, [100] * 10, [100] * 10, [100] * 10)
    opens = [100, 100, 100, 100, 100, 150, 150, 150, 150, 150]
    aaa = _panel(days, opens, opens, opens, opens)
    sig = pd.DataFrame(
        {
            "eligible": [i >= 5 for i in range(10)],
            "exit_signal": [False] * 10,
            "strength": [1.0 if i >= 5 else 0.0 for i in range(10)],
        },
        index=days,
    )
    daily, _ = run_donchian_vwap_portfolio(
        days[0].date(),
        days[-1].date(),
        panels={"SPY": spy, "AAA": aaa},
        signals={"AAA": sig},
        sym_sector={"AAA": "Technology"},
        exit_mode="donchian20",
    )
    assert float(daily.iloc[5]) < 0.05


def test_chandelier_initial_stop_below_entry():
    rows = []
    for i in range(20):
        rows.append({
            "date": f"2026-01-{i+1:02d}",
            "open": 100 + i * 0.1,
            "high": 102 + i * 0.1,
            "low": 98 + i * 0.1,
            "close": 100 + i * 0.1,
            "volume": 1e6,
        })
    df = pd.DataFrame(rows)
    snap = chandelier_trail_snapshot(df, entry_price=100.0, opened=date(2026, 1, 1), asof=date(2026, 1, 20))
    assert snap is not None
    assert snap.stop_price < 100.0


def test_next_session_date_after_signal():
    days = pd.bdate_range("2026-07-01", periods=3)
    ohlcv = _panel(days, [1, 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3])
    nd = next_session_date(ohlcv, days[0].date())
    assert nd == days[1].date()


def test_portfolio_loop_trail_uses_entry_px():
    text = open("pipeline/compute/portfolio_loop.py", encoding="utf-8").read()
    assert "entry_price=entry_px" in text
    assert "fill_day" in text