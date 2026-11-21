"""Robust Donchian+VWAP backtest harness (corrected accounting, walk-forward, benchmarks).

Prefer this module over raw ``grid_search_atr_trail`` OOS ranking for headline results.
Fill rules: ``pipeline/strategies/fill_rules.py``.
"""
from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path

import pandas as pd

from pipeline.research.donchian_vwap_backtest import (
    _metrics,
    benchmark_returns,
    default_atr_param_grid,
    grid_search_atr_trail,
    run_donchian_vwap_portfolio,
)
from pipeline.strategies.costs import CostModel, DEFAULT_LOOP_COSTS

STRESS_COSTS = {
    "10bps": DEFAULT_LOOP_COSTS,
    "25bps": CostModel(commission_bps=12.5, slippage_bps=12.5),
    "50bps": CostModel(commission_bps=25.0, slippage_bps=25.0),
}


@dataclass
class BacktestMetrics:
    cagr: float
    sharpe: float
    sortino: float
    max_dd: float
    calmar: float
    total_return: float
    n_days: int


def deflated_sharpe(sharpe: float, n_obs: int, n_trials: int) -> float:
    if n_trials <= 1 or n_obs < 2:
        return sharpe
    emax = math.sqrt(2 * math.log(n_trials))
    return sharpe - emax / math.sqrt(n_obs)


def compute_metrics(daily: pd.Series) -> BacktestMetrics:
    r = daily.dropna()
    if r.empty:
        return BacktestMetrics(0, 0, 0, 0, 0, 0, 0)
    n = len(r)
    tot = float((1 + r).prod() - 1)
    yrs = n / 252.0
    cagr = (1 + tot) ** (1 / yrs) - 1 if yrs > 0 else 0.0
    vol = float(r.std())
    sharpe = float(r.mean() / vol * math.sqrt(252)) if vol > 0 else 0.0
    neg = r[r < 0]
    ds = float(neg.std()) if len(neg) > 1 else vol
    sortino = float(r.mean() / ds * math.sqrt(252)) if ds > 0 else 0.0
    eq = (1 + r).cumprod()
    max_dd = float((eq / eq.cummax() - 1).min())
    calmar = cagr / abs(max_dd) if max_dd < 0 else 0.0
    return BacktestMetrics(cagr, sharpe, sortino, max_dd, calmar, tot, n)


def average_rebalance_weekdays(
    start: date,
    end: date,
    *,
    data_start: str = "2010-01-04",
    atr_period: int = 14,
    atr_mult: float = 3.0,
    exit_mode: str = "atr_trail",
    rotation_mode: str = "weekly",
    cost: CostModel = DEFAULT_LOOP_COSTS,
    panels=None,
    signals=None,
    sym_sector=None,
) -> tuple[pd.Series, dict]:
    """Average daily returns across Mon–Fri rebalance anchors (headline robustness)."""
    if panels is None or signals is None:
        from pipeline.research.donchian_vwap_backtest import build_research_panels

        panels, signals = build_research_panels(data_start)
    series_list: list[pd.Series] = []
    per_wd: dict = {}
    for wd in range(5):
        daily, _ = run_donchian_vwap_portfolio(
            start,
            end,
            data_start=data_start,
            exit_mode=exit_mode,
            atr_period=atr_period,
            atr_mult=atr_mult,
            panels=panels,
            signals=signals,
            sym_sector=sym_sector,
            rebalance_weekday=wd,
            rotation_mode=rotation_mode,
            cost=cost,
        )
        per_wd[f"dow_{wd}"] = asdict(compute_metrics(daily))
        if not daily.empty:
            series_list.append(daily)
    if not series_list:
        return pd.Series(dtype=float), per_wd
    return pd.concat(series_list, axis=1).mean(axis=1), per_wd


def rolling_walk_forward(
    first_test_year: int,
    last_test_year: int,
    param_grid: list[tuple[int, float]] | None = None,
) -> list[dict]:
    """Rolling 3y train / 1y test blocks."""
    grid = param_grid or default_atr_param_grid()
    out: list[dict] = []
    for y in range(first_test_year, last_test_year + 1):
        train_end = date(y - 1, 12, 31)
        train_start = date(y - 3, 1, 1)
        test_start = date(y, 1, 2)
        test_end = date(y, 12, 31)
        best_sharpe = -999.0
        best: tuple[int, float] | None = None
        for atr_p, atr_m in grid:
            rot = "hold_until_stop" if atr_m >= 3.0 else "weekly"
            daily, _ = run_donchian_vwap_portfolio(
                train_start, train_end, data_start="2008-01-01",
                atr_period=atr_p, atr_mult=atr_m, rotation_mode=rot,
            )
            m = _metrics("train", train_start, train_end, daily)
            if m.sharpe > best_sharpe:
                best_sharpe = m.sharpe
                best = (atr_p, atr_m)
        if best is None:
            continue
        atr_p, atr_m = best
        rot = "hold_until_stop" if atr_m >= 3.0 else "weekly"
        daily, _ = run_donchian_vwap_portfolio(
            test_start, test_end, data_start="2008-01-01",
            atr_period=atr_p, atr_mult=atr_m, rotation_mode=rot,
        )
        tm = _metrics("test", test_start, test_end, daily)
        out.append({
            "test_year": y,
            "chosen_atr_period": atr_p,
            "chosen_atr_mult": atr_m,
            "test_sharpe": tm.sharpe,
            "test_return_pct": tm.total_return_pct,
        })
    return out


def walk_forward_frozen(
    train_end: date,
    test_start: date,
    test_end: date,
    param_grid: list[tuple[int, float]] | None = None,
) -> dict:
    """Pick params on 2010–train_end IS only; report frozen params on test."""
    grid = param_grid or default_atr_param_grid()
    train_start = date(2010, 1, 4)
    best_sharpe = -999.0
    best: tuple[int, float] | None = None
    for atr_p, atr_m in grid:
        rot = "hold_until_stop" if atr_m >= 3.0 else "weekly"
        daily, _ = run_donchian_vwap_portfolio(
            train_start,
            train_end,
            data_start="2009-06-01",
            exit_mode="atr_trail",
            atr_period=atr_p,
            atr_mult=atr_m,
            rotation_mode=rot,
        )
        m = _metrics("train", train_start, train_end, daily)
        if m.sharpe > best_sharpe:
            best_sharpe = m.sharpe
            best = (atr_p, atr_m)
    if best is None:
        return {"error": "no_train_data"}
    atr_p, atr_m = best
    rot = "hold_until_stop" if atr_m >= 3.0 else "weekly"
    test_daily, _ = run_donchian_vwap_portfolio(
        test_start,
        test_end,
        data_start="2009-06-01",
        exit_mode="atr_trail",
        atr_period=atr_p,
        atr_mult=atr_m,
        rotation_mode=rot,
    )
    test_m = _metrics("test", test_start, test_end, test_daily)
    n_trials = len(grid)
    return {
        "chosen_atr_period": atr_p,
        "chosen_atr_mult": atr_m,
        "rotation_mode": rot,
        "n_trials": n_trials,
        "train_sharpe_at_choice": best_sharpe,
        "test_return_pct": test_m.total_return_pct,
        "test_sharpe": test_m.sharpe,
        "test_max_dd_pct": test_m.max_drawdown_pct,
        "deflated_test_sharpe": deflated_sharpe(test_m.sharpe, test_m.days, n_trials),
    }


def benchmark_suite(start: date, end: date) -> dict[str, BacktestMetrics]:
    return {t: compute_metrics(benchmark_returns(start, end, t)) for t in ("SPY", "QQQ", "RSP")}


def build_summary(
    start: date = date(2023, 1, 3),
    end: date | None = None,
    out_dir: Path | None = None,
    *,
    panels=None,
    signals=None,
    skip_walk_forward: bool = False,
) -> dict:
    if end is None:
        end = date.today()
    if panels is None or signals is None:
        from pipeline.research.donchian_vwap_backtest import build_research_panels

        panels, signals = build_research_panels("2009-06-01")
    headline, wd_breakdown = average_rebalance_weekdays(
        start, end, atr_mult=3.0, rotation_mode="hold_until_stop",
        panels=panels, signals=signals,
    )
    legacy, _ = run_donchian_vwap_portfolio(
        start, end, atr_mult=2.0, legacy_accounting=True, panels=panels, signals=signals,
    )
    corrected_weekly, _ = run_donchian_vwap_portfolio(
        start, end, atr_mult=2.0, rotation_mode="weekly", panels=panels, signals=signals,
    )
    wf = (
        {"skipped": True, "n_trials": len(default_atr_param_grid())}
        if skip_walk_forward
        else walk_forward_frozen(date(2018, 12, 31), date(2019, 1, 2), end)
    )
    costs: dict = {}
    for label, cm in STRESS_COSTS.items():
        d, _ = average_rebalance_weekdays(start, end, cost=cm, panels=panels, signals=signals)
        costs[label] = asdict(compute_metrics(d))
    summary = {
        "window": {"start": start.isoformat(), "end": end.isoformat()},
        "headline_avg_weekday_hold_until_stop_atr3": asdict(compute_metrics(headline)),
        "weekday_breakdown": wd_breakdown,
        "corrected_weekly_atr2_equal_avg": asdict(compute_metrics(corrected_weekly)),
        "legacy_broken_releverage_exit_day": asdict(compute_metrics(legacy)),
        "benchmarks": {k: asdict(v) for k, v in benchmark_suite(start, end).items()},
        "cost_stress_avg_weekday": costs,
        "walk_forward_frozen": wf,
        "pit_membership_note": (
            "Universe is live S&P500∪NDX scrape (survivorship). "
            "Pass a CSV with asof_date,symbol to extend harness for PIT membership."
        ),
        "invalid_legacy_artifact": "pipeline/research/artifacts/donchian_atr_trail_grid.json",
    }
    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "loop_donchian_harness_summary.json").write_text(
            json.dumps(summary, indent=2), encoding="utf-8",
        )
    return summary