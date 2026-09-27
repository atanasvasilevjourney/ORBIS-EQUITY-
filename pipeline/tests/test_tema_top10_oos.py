"""Unit tests for TEMA top-10 OOS selection (synthetic, no network)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline.research.tema_backtest import synth_trend
from pipeline.research.tema_top10_oos import (
    check_gate,
    evaluate_ticker,
    portfolio_oos_returns,
    run_top10,
)
from pipeline.research.kama_backtest import TRAIN_RATIO


def _series(close: np.ndarray, ticker: str = "SYN") -> pd.Series:
    idx = pd.date_range("2018-01-01", periods=len(close), freq="B")
    return pd.Series(close, index=idx, name=ticker)


def test_evaluate_ticker_on_trend():
    close = _series(synth_trend(500, seed=3))
    row = evaluate_ticker("SYN", close)
    assert row is not None
    assert row.n_bars == 500
    assert row.is_sharpe == row.is_sharpe  # finite


def test_portfolio_oos_returns_shape():
    a = _series(synth_trend(400, seed=1), "A")
    b = _series(synth_trend(400, seed=2), "B")
    _idx, port, bh = portfolio_oos_returns(["A", "B"], {"A": a, "B": b})
    assert port.size > 60
    assert bh.size == port.size


def test_check_gate_passes_with_strong_metrics():
    from pipeline.research.tema_top10_oos import TickerSplit

    top = [
        TickerSplit("A", 400, 1.0, 0.8, 0.1, 0.12, -0.1, 10, "2022-01-01", "2022-01-02", "2024-01-01"),
        TickerSplit("B", 400, 0.9, 0.7, 0.1, 0.10, -0.1, 8, "2022-01-01", "2022-01-02", "2024-01-01"),
        TickerSplit("C", 400, 0.8, 0.6, 0.1, 0.08, -0.1, 6, "2022-01-01", "2022-01-02", "2024-01-01"),
    ]
    port = {"sharpe": 1.0, "cagr": 0.15}
    bh = {"sharpe": 0.5, "cagr": 0.10}
    ok, _, checks = check_gate(top, port, bh)  # type: ignore[arg-type]
    assert ok
    assert checks["portfolio_oos_sharpe"]


def test_run_top10_empty_without_network(monkeypatch):
    def _fail(_t: str, _s: str):
        raise RuntimeError("offline")

    monkeypatch.setattr("pipeline.research.tema_top10_oos.download_close", _fail)
    r = run_top10(tickers=["AAA"], top_n=3)
    assert r.top10 == []
    assert not r.gate_passed
