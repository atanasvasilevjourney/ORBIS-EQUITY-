"""TEMA grid and Optuna search. No network."""
import numpy as np
import pandas as pd
import pytest

from pipeline.compute.perps_math import MIN_BARS
from pipeline.research.tema_backtest import synth_trend, tema_position_series
from pipeline.research.tema_search import (
    TemaParams,
    brute_force_grid,
    evaluate,
    max_eligible_slow,
    optimizer_pick,
    panel_from_close_frame,
    production_params,
    rank_equity_symbols,
    run_optuna,
)


def _trend_panel(n: int = 500, symbols: int = 3, seed: int = 0):
    columns = {}
    for i in range(symbols):
        columns[f"S{i}"] = synth_trend(n, drift=0.0008, vol=0.01, seed=seed + i)
    frame = pd.DataFrame(columns, index=pd.bdate_range("2023-01-02", periods=n))
    return panel_from_close_frame(frame)


def test_grid_is_ordered_and_exhaustive():
    rows = brute_force_grid()
    # slow 60 and 90 cannot pair with the longest mids, so the rectangle is smaller than 4×5×5×2.
    assert len(rows) == 170
    assert all(row.fast < row.mid < row.slow for row in rows)
    gates = {row.kama_gate for row in rows}
    assert gates == {0, 1}


def test_rank_keeps_the_larger_share_class():
    rows = [
        {"symbol": "GOOGL", "market_cap": 4008e9, "company_name": "Alphabet Inc. - Class A Common Stock"},
        {"symbol": "GOOG", "market_cap": 4006e9, "company_name": "Alphabet Inc. - Class C Capital Stock"},
        {"symbol": "AAPL", "market_cap": 5000e9, "company_name": "Apple Inc."},
        {"symbol": "TINY", "market_cap": 1e9, "company_name": "Tiny"},
    ]
    assert rank_equity_symbols(rows, n=2) == ["AAPL", "GOOGL"]


def test_slow_span_must_leave_a_train_window():
    assert max_eligible_slow(306) == 142


def test_vectorized_signal_matches_production_helper():
    close = synth_trend(500, seed=3)
    panel = panel_from_close_frame(
        pd.DataFrame({"SYN": close}, index=pd.bdate_range("2023-01-02", periods=500))
    )
    params = TemaParams(fast=9, mid=99, slow=199, kama_gate=0)
    got = panel.signal(params, warmup=MIN_BARS - 1)[0]
    np.testing.assert_allclose(got, tema_position_series(close))


def test_uptrend_book_is_eligible_and_a_forced_long_earns_the_drift():
    panel = _trend_panel()
    row = evaluate(panel, TemaParams(fast=8, mid=21, slow=60, kama_gate=0), source="grid")
    assert row["eligible"] is True
    assert row["is_days"] >= 40
    assert row["oos_days"] >= 40
    assert row["objective"] == row["is_sharpe"]
    assert np.isfinite(row["is_sharpe"])

    forced = np.zeros(panel.closes.shape)
    forced[:, 30:] = 1.0
    daily, _weight = panel.book_returns(forced)
    raw = np.mean(np.nan_to_num(panel.rets, nan=0.0), axis=0)
    # Weight turns on at the next bar and pays one side there. Later bars match the drift.
    assert daily[31] == pytest.approx(raw[31] - 0.001)
    assert daily[40] == pytest.approx(raw[40])
    assert daily[40:].mean() > 0


def test_slow_span_on_a_short_tape_is_not_eligible():
    panel = _trend_panel(n=220, symbols=2)
    row = evaluate(panel, TemaParams(fast=9, mid=99, slow=199, kama_gate=1), source="production")
    assert row["eligible"] is False
    assert row["objective"] < 0


def test_optimizer_pick_uses_train_sharpe_only():
    rows = [
        {"eligible": True, "is_sharpe": 1.2, "oos_sharpe": 0.1, "is_n_trades": 30, "is_max_drawdown": -0.2},
        {"eligible": True, "is_sharpe": 0.4, "oos_sharpe": 3.0, "is_n_trades": 80, "is_max_drawdown": -0.05},
        {"eligible": False, "is_sharpe": 5.0, "oos_sharpe": 5.0, "is_n_trades": 1, "is_max_drawdown": -0.01},
    ]
    pick = optimizer_pick(rows)
    assert pick is not None
    assert pick["is_sharpe"] == 1.2


def test_optuna_returns_one_row_per_trial():
    panel = _trend_panel(n=420, symbols=2, seed=11)
    seed = evaluate(panel, TemaParams(fast=8, mid=21, slow=60, kama_gate=0), source="grid")
    rows = run_optuna(panel, n_trials=3, seed_rows=[seed], seed=2)
    assert len(rows) == 3
    assert all(row["source"] == "optuna" for row in rows)
    assert all(row["fast"] < row["mid"] < row["slow"] for row in rows)


def test_production_params_are_the_live_stack():
    params = production_params()
    assert (params.fast, params.mid, params.slow) == (9, 99, 199)
    assert params.kama_gate == 1
