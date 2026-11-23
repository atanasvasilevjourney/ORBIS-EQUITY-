"""LOOP as index overlay/filter — pre-declared variants (not a standalone picker).

Uses corrected LOOP signals (Donchian 55 + VWAP 20), PIT S&P 500 breadth,
T-bill cash (BIL), and walk-forward windows aligned with loop_donchian_harness.
"""
from __future__ import annotations

import json
import math
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd
import yfinance as yf

from pipeline.compute.atr_risk import compute_atr
from pipeline.compute.donchian_vwap import donchian_frame
from pipeline.research.donchian_vwap_backtest import (
    _bar_on,
    benchmark_returns,
    build_research_panels,
)
from pipeline.research.loop_donchian_harness import (
    TEST_START,
    TRAIN_END,
    TRAIN_START,
    average_rebalance_weekdays,
    compute_metrics,
    deflated_sharpe,
)
from pipeline.strategies.costs import CostModel, DEFAULT_LOOP_COSTS

STRESS_COSTS = CostModel(commission_bps=12.5, slippage_bps=12.5)

# Pre-declared before any 2019+ evaluation (7 variants total for deflation).
OVERLAY_VARIANTS: tuple[str, ...] = (
    "breadth_spy_15_cash",
    "breadth_rsp_15_cash",
    "breadth_spy_15_half",
    "core_spy_80_loop_20",
    "core_spy_90_loop_10",
    "spy_donchian_vwap_cash",
    "spy_chandelier_atr14_x3",
)
N_OVERLAY_TRIALS = len(OVERLAY_VARIANTS)

# Frozen LOOP sleeve params (matches frozen walk-forward pick on 2010–2018 train in harness).
LOOP_SLEEVE_ATR_PERIOD = 14
LOOP_SLEEVE_ATR_MULT = 3.5
LOOP_SLEEVE_ROTATION = "hold_until_stop"

BREADTH_THRESH = 0.15
BREADTH_THRESH_HALF = 0.15


def _flat_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    """Ensure single-level OHLCV columns (yfinance batch quirks)."""
    out = df.copy()
    if isinstance(out.columns, pd.MultiIndex):
        # Batch download: keep the first ticker level if present.
        if out.columns.nlevels >= 2:
            out = out.xs(out.columns.levels[1][0], axis=1, level=1, drop_level=False)
        out.columns = [str(c[0] if isinstance(c, tuple) else c).lower() for c in out.columns]
    else:
        out.columns = [str(c).lower() for c in out.columns]
    out.index = pd.to_datetime(out.index)
    if getattr(out.index, "tz", None) is not None:
        out.index = out.index.tz_localize(None)
    for col in ("open", "high", "low", "close", "volume"):
        if col not in out.columns:
            continue
        s = out[col]
        if isinstance(s, pd.DataFrame):
            s = s.iloc[:, 0]
        out[col] = pd.to_numeric(s, errors="coerce")
    if "close" not in out.columns:
        raise KeyError("close")
    return out.dropna(subset=["close"])


def _spy_ohlcv_panel(panels: dict[str, pd.DataFrame], data_start: str) -> pd.DataFrame:
    raw = panels.get("SPY")
    if raw is not None:
        try:
            return _flat_ohlcv(raw)
        except (KeyError, ValueError, TypeError):
            pass
    h = yf.download("SPY", start=data_start, progress=False, auto_adjust=True)
    df = h.rename(columns=str.lower)[["open", "high", "low", "close", "volume"]].dropna()
    return _flat_ohlcv(df)


@dataclass
class OverlayMetrics:
    cagr: float
    sharpe: float
    max_dd: float
    total_return: float
    n_days: int
    time_in_market: float
    dd_2020: float
    dd_2022: float
    deflated_sharpe: float


def tbill_returns(start: date, end: date) -> pd.Series:
    """Cash leg: BIL (1–3 month T-bill ETF) daily returns, aligned to equity sessions."""
    try:
        h = yf.Ticker("BIL").history(start=start.isoformat(), end=end.isoformat(), auto_adjust=True)
        if not h.empty:
            h.index = h.index.tz_localize(None) if h.index.tz else h.index
            return h["Close"].pct_change().dropna()
    except Exception:
        pass
    return pd.Series(0.0, index=benchmark_returns(start, end, "SPY").index)


def _period_max_dd(daily: pd.Series, y0: int, y1: int) -> float:
    mask = (daily.index.year >= y0) & (daily.index.year <= y1)
    r = daily.loc[mask].dropna()
    if r.empty:
        return 0.0
    eq = (1 + r).cumprod()
    return float((eq / eq.cummax() - 1).min())


def overlay_metrics(
    daily: pd.Series,
    exposure: pd.Series | None = None,
    *,
    n_trials: int = N_OVERLAY_TRIALS,
) -> OverlayMetrics:
    base = compute_metrics(daily)
    exp = exposure.reindex(daily.index).fillna(0) if exposure is not None else pd.Series(1.0, index=daily.index)
    tim = float((exp > 0.05).mean()) if len(exp) else 0.0
    dsh = deflated_sharpe(base.sharpe, base.n_days, n_trials)
    return OverlayMetrics(
        base.cagr,
        base.sharpe,
        base.max_dd,
        base.total_return,
        base.n_days,
        tim,
        _period_max_dd(daily, 2020, 2020),
        _period_max_dd(daily, 2022, 2022),
        dsh,
    )


def compute_pit_breadth_series(
    calendar: pd.DatetimeIndex,
    signals: dict[str, pd.DataFrame],
    membership_lookup: Callable[[date], set[str]],
) -> pd.Series:
    """Share of PIT S&P 500 names with prior-session ``eligible`` (LOOP long entry signal)."""
    rows: list[tuple[pd.Timestamp, float]] = []
    days = [d.date() if hasattr(d, "date") else d for d in calendar]
    for i, d in enumerate(days):
        sig_day = days[max(0, i - 1)]
        pit = membership_lookup(sig_day)
        if not pit:
            rows.append((pd.Timestamp(d), float("nan")))
            continue
        n_elig = 0
        for sym in pit:
            sig = signals.get(sym)
            if sig is None:
                continue
            row = _bar_on(sig, sig_day)
            if row is not None and bool(row.get("eligible", False)):
                n_elig += 1
        rows.append((pd.Timestamp(d), n_elig / len(pit)))
    return pd.Series(dict(rows)).sort_index()


def _apply_exposure_overlay(
    index_ret: pd.Series,
    cash_ret: pd.Series,
    exposure: pd.Series,
    *,
    cost: CostModel = DEFAULT_LOOP_COSTS,
) -> tuple[pd.Series, pd.Series]:
    """``exposure`` in [0,1]: daily return = exp * index + (1-exp) * cash minus turnover costs."""
    idx = index_ret.index.intersection(cash_ret.index).intersection(exposure.index)
    if idx.empty:
        return pd.Series(dtype=float), pd.Series(dtype=float)
    ir = index_ret.reindex(idx).fillna(0)
    cr = cash_ret.reindex(idx).fillna(0)
    exp = exposure.reindex(idx).fillna(0).clip(0, 1)
    gross = exp * ir + (1 - exp) * cr
    turn = exp.diff().abs().fillna(exp.iloc[0])
    net = gross - turn * float(cost.bps_per_side) / 10_000.0
    return net, exp


def breadth_regime_returns(
    start: date,
    end: date,
    ticker: Literal["SPY", "RSP"],
    mode: Literal["cash", "half"],
    *,
    breadth: pd.Series,
    threshold: float = BREADTH_THRESH,
    cost: CostModel = DEFAULT_LOOP_COSTS,
) -> tuple[pd.Series, pd.Series]:
    idx = benchmark_returns(start, end, ticker)
    cash = tbill_returns(start, end)
    cal = idx.index.intersection(breadth.index)
    exp = pd.Series(0.0, index=cal)
    for ts in cal:
        b = breadth.get(ts, float("nan"))
        if not math.isfinite(b):
            exp.loc[ts] = 0.0
            continue
        if mode == "cash":
            exp.loc[ts] = 1.0 if b >= threshold else 0.0
        else:
            exp.loc[ts] = 1.0 if b >= threshold else 0.5
    return _apply_exposure_overlay(idx, cash, exp, cost=cost)


def spy_donchian_vwap_overlay(
    start: date,
    end: date,
    spy_ohlcv: pd.DataFrame,
    *,
    cost: CostModel = DEFAULT_LOOP_COSTS,
) -> tuple[pd.Series, pd.Series]:
    spy_ohlcv = _flat_ohlcv(spy_ohlcv)
    frame = donchian_frame(spy_ohlcv)
    idx = benchmark_returns(start, end, "SPY")
    cash = tbill_returns(start, end)
    cal = idx.index.intersection(frame.index)
    exp = pd.Series(0.0, index=cal)
    days = [d.date() if hasattr(d, "date") else d for d in cal]
    for i, d in enumerate(days):
        sig_day = days[max(0, i - 1)]
        row = _bar_on(frame, sig_day)
        exp.iloc[i] = 1.0 if row is not None and bool(row.get("eligible", False)) else 0.0
    return _apply_exposure_overlay(idx, cash, exp, cost=cost)


def _bar_ohlc(ohlcv: pd.DataFrame, d: date) -> tuple[float, float, float] | None:
    ts = pd.Timestamp(d)
    hits = ohlcv.index.normalize() == ts
    if not hits.any():
        return None
    row = ohlcv.iloc[int(np.where(hits)[0][0])]
    return float(row["high"]), float(row["low"]), float(row["close"])


def spy_chandelier_overlay(
    start: date,
    end: date,
    spy_ohlcv: pd.DataFrame,
    *,
    atr_period: int = 14,
    atr_mult: float = 3.0,
    cost: CostModel = DEFAULT_LOOP_COSTS,
) -> tuple[pd.Series, pd.Series]:
    """Hold SPY when price rides above ATR(14)×3 chandelier; otherwise BIL (no same-bar lookahead)."""
    spy_ohlcv = _flat_ohlcv(spy_ohlcv)
    frame = donchian_frame(spy_ohlcv)
    idx = benchmark_returns(start, end, "SPY")
    cash = tbill_returns(start, end)
    cal = idx.index
    days = [d.date() if hasattr(d, "date") else d for d in cal]
    exp_vals: list[float] = []
    in_pos = False
    peak = 0.0
    stop = 0.0
    for i, d in enumerate(days):
        exp_vals.append(1.0 if in_pos else 0.0)
        bar = _bar_ohlc(spy_ohlcv, d)
        if bar is None:
            continue
        hi, _, close = bar
        ts = pd.Timestamp(d)
        hits = spy_ohlcv.index.normalize() == ts
        op = float(spy_ohlcv.iloc[int(np.where(hits)[0][0])]["open"]) if hits.any() else close
        loc_hits = spy_ohlcv.index.normalize() <= ts
        window = spy_ohlcv.loc[loc_hits]
        if len(window) < atr_period + 2:
            continue
        atr_s = compute_atr(window.reset_index(drop=True), period=atr_period)
        atr = float(atr_s.iloc[-1])
        if not np.isfinite(atr) or atr <= 0:
            continue
        if not in_pos:
            sig_day = days[max(0, i - 1)]
            row = _bar_on(frame, sig_day)
            if row is not None and bool(row.get("eligible", False)):
                in_pos = True
                peak = close
                stop = close - atr_mult * atr
        if in_pos:
            if op < stop:
                in_pos = False
            else:
                peak = max(peak, hi)
                stop = max(stop, peak - atr_mult * atr)
                if close < stop:
                    in_pos = False
    exp = pd.Series(exp_vals, index=cal)
    return _apply_exposure_overlay(idx, cash, exp, cost=cost)


def core_satellite_returns(
    start: date,
    end: date,
    spy_weight: float,
    loop_daily: pd.Series,
    *,
    cost: CostModel = DEFAULT_LOOP_COSTS,
) -> tuple[pd.Series, pd.Series]:
    spy = benchmark_returns(start, end, "SPY")
    idx = spy.index.intersection(loop_daily.index)
    spy = spy.reindex(idx).fillna(0)
    loop = loop_daily.reindex(idx).fillna(0)
    w = float(spy_weight)
    blended = w * spy + (1 - w) * loop
    return blended, pd.Series(w, index=idx)


def _slice_metrics(daily: pd.Series, exposure: pd.Series | None, start: date, end: date) -> dict:
    mask = (daily.index >= pd.Timestamp(start)) & (daily.index <= pd.Timestamp(end))
    d = daily.loc[mask]
    e = exposure.loc[mask] if exposure is not None else None
    return asdict(overlay_metrics(d, e))


def build_overlay_summary(
    end: date | None = None,
    *,
    pit_panels=None,
    pit_signals=None,
    pit_sym_sector=None,
    pit_lookup=None,
    data_start: str = "2009-06-01",
    return_series: bool = False,
) -> dict | tuple[dict, dict[str, tuple[pd.Series, pd.Series]]]:
    if end is None:
        end = date.today()
    if pit_lookup is None or pit_panels is None:
        from pipeline.research.sp500_pit import (
            build_sp500_sym_sector,
            membership_lookup,
            union_symbols_between,
        )

        pit_lookup = membership_lookup()
        syms = union_symbols_between(TRAIN_START, end)
        pit_sym_sector = build_sp500_sym_sector(syms)
        pit_panels, pit_signals, _ = build_research_panels(
            data_start, sym_sector=pit_sym_sector, symbols=sorted(syms)
        )
    spy_panel = _spy_ohlcv_panel(pit_panels, data_start)

    breadth = compute_pit_breadth_series(spy_panel.index, pit_signals, pit_lookup)

    loop_daily, _ = average_rebalance_weekdays(
        TRAIN_START,
        end,
        data_start=data_start,
        atr_period=LOOP_SLEEVE_ATR_PERIOD,
        atr_mult=LOOP_SLEEVE_ATR_MULT,
        rotation_mode=LOOP_SLEEVE_ROTATION,
        panels=pit_panels,
        signals=pit_signals,
        sym_sector=pit_sym_sector,
        membership_lookup=pit_lookup,
    )

    variants: dict[str, tuple[pd.Series, pd.Series]] = {}
    variants["breadth_spy_15_cash"] = breadth_regime_returns(
        TRAIN_START, end, "SPY", "cash", breadth=breadth, threshold=BREADTH_THRESH
    )
    variants["breadth_rsp_15_cash"] = breadth_regime_returns(
        TRAIN_START, end, "RSP", "cash", breadth=breadth, threshold=BREADTH_THRESH
    )
    variants["breadth_spy_15_half"] = breadth_regime_returns(
        TRAIN_START, end, "SPY", "half", breadth=breadth, threshold=BREADTH_THRESH_HALF
    )
    variants["core_spy_80_loop_20"] = core_satellite_returns(TRAIN_START, end, 0.80, loop_daily)
    variants["core_spy_90_loop_10"] = core_satellite_returns(TRAIN_START, end, 0.90, loop_daily)
    variants["spy_donchian_vwap_cash"] = spy_donchian_vwap_overlay(TRAIN_START, end, spy_panel)
    variants["spy_chandelier_atr14_x3"] = spy_chandelier_overlay(TRAIN_START, end, spy_panel)

    stress: dict[str, dict] = {}
    for name in ("breadth_spy_15_cash", "spy_chandelier_atr14_x3"):
        if name == "breadth_spy_15_cash":
            d, e = breadth_regime_returns(
                TRAIN_START, end, "SPY", "cash", breadth=breadth, cost=STRESS_COSTS
            )
        else:
            d, e = spy_chandelier_overlay(TRAIN_START, end, spy_panel, cost=STRESS_COSTS)
        stress[name] = asdict(overlay_metrics(d, e))

    full_metrics = {
        k: _slice_metrics(d, e, TRAIN_START, end) for k, (d, e) in variants.items()
    }
    train_metrics = {
        k: _slice_metrics(d, e, TRAIN_START, TRAIN_END) for k, (d, e) in variants.items()
    }
    test_metrics = {
        k: _slice_metrics(d, e, TEST_START, end) for k, (d, e) in variants.items()
    }
    spy_full = benchmark_returns(TRAIN_START, end, "SPY")
    annual_oos: dict[str, dict[str, float]] = {}
    for y in range(TEST_START.year, end.year + 1):
        annual_oos[str(y)] = {}
        for k, (d, _) in variants.items():
            yr = d.loc[d.index.year == y]
            annual_oos[str(y)][k] = compute_metrics(yr).sharpe
        annual_oos[str(y)]["SPY"] = compute_metrics(spy_full.loc[spy_full.index.year == y]).sharpe

    benchmarks = {}
    for t in ("SPY", "RSP", "QQQ"):
        b = benchmark_returns(TEST_START, end, t)
        benchmarks[t] = _slice_metrics(b, None, TEST_START, end)
    benchmarks["SPY_buy_hold_full"] = _slice_metrics(
        benchmark_returns(TRAIN_START, end, "SPY"), None, TEST_START, end
    )

    summary = {
        "predeclared_variants": list(OVERLAY_VARIANTS),
        "n_trials_deflation": N_OVERLAY_TRIALS,
        "breadth_threshold": BREADTH_THRESH,
        "loop_sleeve": {
            "atr_period": LOOP_SLEEVE_ATR_PERIOD,
            "atr_mult": LOOP_SLEEVE_ATR_MULT,
            "rotation": LOOP_SLEEVE_ROTATION,
            "universe": "PIT S&P 500",
        },
        "train_window": {"start": TRAIN_START.isoformat(), "end": TRAIN_END.isoformat()},
        "test_window": {"start": TEST_START.isoformat(), "end": end.isoformat()},
        "variants_full": full_metrics,
        "variants_train": train_metrics,
        "variants_oos_frozen": test_metrics,
        "rolling_oos_annual_sharpe": annual_oos,
        "benchmarks_oos": benchmarks,
        "cost_stress_25bps_sample": stress,
        "cash_leg": "BIL",
        "default_cost_bps_side": 10,
    }
    if return_series:
        return summary, variants
    return summary


def write_summary_json(summary: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, indent=2), encoding="utf-8")