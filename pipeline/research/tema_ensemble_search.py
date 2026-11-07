"""Grid + Bayesian search for the TEMA-MACD ensemble.

Research harness only. It does not rewrite `TEMA_MACD_GRID` or the 9/99/199
cash-book spans. Production stays one global vote; this study asks whether a
different compact set would have earned that seat.

Protocol
  Folds on the overlapping calendar: 50% train, 25% validation, 25% locked.
  A triple is long when its TEMA-MACD histogram is positive. The position at
  the close of bar t earns the close-to-close return t → t+1.
  The objective is the annualized Sharpe of the equal-weight panel.
  Triples with fewer than 2 trades/year on the train window are dropped.

  Grid: fast ∈ {5, 8, 9, 12, 15, 20}, slow ∈ {21, 26, 34, 40, 50, 63, 80, 100},
  signal = 9, and slow ≥ fast + 8. Scored with
  `param_stability.evaluate_param_grid` (IS = train, OOS = validation).
  The promotion floor is IS Sharpe > 1.0. Nothing below that floor can replace
  the production six.

  Bayesian step: a univariate TPE samples (fast, slow, signal) on the train
  fold only. The best train trials plus their integer neighbors are passed to
  the same stability gate on the validation fold. The locked fold is scored
  once, after selection, and is never an input to the sampler or the gate.

  A candidate ensemble is promoted only when its validation neighborhood is
  tighter than the production six AND its locked Sharpe is positive and at
  least as high as the production ensemble. This script prints that decision.
  It does not edit the nightly constants.

Usage:
    PYTHONPATH=/workspace python -m pipeline.research.tema_ensemble_search
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Mapping, Sequence

import numpy as np
import pandas as pd

from pipeline.compute.canary_math import ENSEMBLE_LONG, ENSEMBLE_SHORT, TEMA_MACD_GRID
from pipeline.compute.param_stability import annualized_sharpe, score_candidates
from pipeline.compute.perps_math import ema, tema
from pipeline.research.kama_backtest import compute_metrics, download_close
from pipeline.research.tema_backtest import tema_position_series

BARS_PER_YEAR = 252.0
MIN_TRADES_PER_YEAR = 2.0
IS_SHARPE_FLOOR = 1.0
FAST_GAP = 8
SIGNAL_FIXED = 9
FAST_MENU = (5, 8, 9, 12, 15, 20)
SLOW_MENU = (21, 26, 34, 40, 50, 63, 80, 100)
# Integer cuts that actually differ for a 6-vote book. 0.50 and 0.55 are the
# same rule when every vote is finite: both need 4 of 6. The strict cut needs 5.
THRESHOLD_RULES: tuple[tuple[str, float, float], ...] = (
    ("production", ENSEMBLE_LONG, ENSEMBLE_SHORT),
    ("strict", 5.0 / 6.0, 1.0 / 6.0),
    ("majority", 0.5, 0.5),
)
DEFAULT_TICKERS = ("SPY", "QQQ", "IWM", "AAPL", "MSFT", "XOM", "JPM", "ADM", "AON")
DEFAULT_START = "2010-01-01"
TPE_TRIALS = 64
TPE_STARTUP = 16


@dataclass
class ClosePanel:
    tickers: tuple[str, ...]
    dates: pd.DatetimeIndex
    closes: dict[str, np.ndarray]


@dataclass
class FoldMap:
    """Slices on the *return* index (length = n_closes - 1)."""

    train: slice
    valid: slice
    lock: slice
    train_end_close: int
    valid_end_close: int

    def as_dict(self) -> dict[str, slice]:
        return {"train": self.train, "valid": self.valid, "lock": self.lock}


@dataclass
class HistCache:
    closes: dict[str, np.ndarray]
    _tema: dict[tuple[str, int], np.ndarray] = field(default_factory=dict)
    _hist: dict[tuple[str, int, int, int], np.ndarray] = field(default_factory=dict)

    def hist(self, ticker: str, fast: int, slow: int, signal: int) -> np.ndarray:
        key = (ticker, fast, slow, signal)
        hit = self._hist.get(key)
        if hit is not None:
            return hit
        close = self.closes[ticker]
        out = tema_macd_hist_series(
            close, fast, slow, signal, tema_fn=self._tema_of, ticker=ticker
        )
        self._hist[key] = out
        return out

    def _tema_of(self, ticker: str, span: int) -> np.ndarray:
        key = (ticker, span)
        hit = self._tema.get(key)
        if hit is None:
            hit = tema(self.closes[ticker], span)
            self._tema[key] = hit
        return hit


def tema_macd_hist_series(
    close: np.ndarray,
    fast: int,
    slow: int,
    signal: int = 9,
    tema_fn: Callable[[str, int], np.ndarray] | None = None,
    ticker: str = "",
) -> np.ndarray:
    """TEMA(fast) − TEMA(slow), minus an EMA signal. Warmup bars are NaN.

    `tema_fn(ticker, span)` is an optional cache. The default calls `tema`.
    """
    x = np.asarray(close, dtype=float)
    n = int(x.size)
    out = np.full(n, np.nan)
    need = int(slow) + int(signal) + 5
    if n < need or fast < 1 or slow <= fast or signal < 1:
        return out
    if tema_fn is None:
        line = tema(x, fast) - tema(x, slow)
    else:
        line = tema_fn(ticker, fast) - tema_fn(ticker, slow)
    sig = ema(line, signal)
    hist = line - sig
    out[need - 1 :] = hist[need - 1 :]
    return out


def sign_position(hist: np.ndarray) -> np.ndarray:
    """+1 / −1 / 0 from the histogram sign. NaN stays flat."""
    h = np.asarray(hist, dtype=float)
    pos = np.zeros(h.size, dtype=float)
    fin = np.isfinite(h)
    pos[fin & (h > 0)] = 1.0
    pos[fin & (h < 0)] = -1.0
    return pos


def ensemble_position(hists: Sequence[np.ndarray], long_th: float, short_th: float) -> np.ndarray:
    """Vote share of positive histograms. Ties (both thresholds true) stay flat."""
    if not hists:
        return np.array([], dtype=float)
    n = int(hists[0].size)
    n_long = np.zeros(n, dtype=float)
    n_cfg = np.zeros(n, dtype=float)
    for h in hists:
        arr = np.asarray(h, dtype=float)
        fin = np.isfinite(arr)
        n_cfg += fin
        n_long += fin & (arr > 0)
    ens = np.divide(n_long, n_cfg, out=np.full(n, np.nan), where=n_cfg > 0)
    pos = np.zeros(n, dtype=float)
    long = np.isfinite(ens) & (ens >= long_th - 1e-12)
    short = np.isfinite(ens) & (ens <= short_th + 1e-12)
    pos[long & ~short] = 1.0
    pos[short & ~long] = -1.0
    return pos


def next_bar_returns(close: np.ndarray, position: np.ndarray) -> np.ndarray:
    x = np.asarray(close, dtype=float)
    rets = np.diff(x) / np.where(x[:-1] == 0, np.nan, x[:-1])
    rets = np.nan_to_num(rets, nan=0.0)
    pos = np.asarray(position, dtype=float)
    return pos[:-1] * rets


def trades_per_year(position: np.ndarray, bars: int | None = None) -> float:
    pos = np.asarray(position, dtype=float)
    if pos.size < 2:
        return 0.0
    flips = int(np.sum(np.diff(pos) != 0))
    n = int(bars if bars is not None else pos.size)
    years = max(n / BARS_PER_YEAR, 1e-9)
    return flips / years


def default_param_grid() -> list[dict[str, int]]:
    grid: list[dict[str, int]] = []
    for fast in FAST_MENU:
        for slow in SLOW_MENU:
            if slow < fast + FAST_GAP:
                continue
            grid.append({"fast": fast, "slow": slow, "signal": SIGNAL_FIXED})
    return grid


def production_params() -> list[dict[str, int]]:
    return [{"fast": f, "slow": s, "signal": g} for f, s, g in TEMA_MACD_GRID]


def make_panel(series: Mapping[str, pd.Series]) -> ClosePanel:
    frame = pd.concat({k: v.astype(float) for k, v in series.items()}, axis=1, join="inner")
    frame = frame.dropna(how="any")
    if frame.shape[0] < 400 or frame.shape[1] == 0:
        raise ValueError(f"panel too small: {frame.shape}")
    closes = {c: frame[c].to_numpy(dtype=float) for c in frame.columns}
    return ClosePanel(tickers=tuple(frame.columns), dates=frame.index, closes=closes)


def fold_map(n_closes: int) -> FoldMap:
    n_ret = n_closes - 1
    a = int(n_ret * 0.50)
    b = int(n_ret * 0.75)
    if a < 80 or b - a < 40 or n_ret - b < 40:
        raise ValueError(f"not enough returns to fold: {n_ret}")
    return FoldMap(
        train=slice(0, a),
        valid=slice(a, b),
        lock=slice(b, n_ret),
        train_end_close=a,
        valid_end_close=b,
    )


def _metrics(strat: np.ndarray, position: np.ndarray) -> dict:
    m = asdict(compute_metrics(strat, position=position))
    for k, v in list(m.items()):
        if isinstance(v, float):
            m[k] = round(v, 6)
    return m


def _panel_mean(columns: list[np.ndarray]) -> np.ndarray:
    return np.mean(np.vstack(columns), axis=0)


class StudyEvaluator:
    """Cached next-bar panel results for triples and ensembles."""

    def __init__(self, panel: ClosePanel):
        self.panel = panel
        self.folds = fold_map(len(panel.dates))
        self.cache = HistCache(panel.closes)
        self._triple_ret: dict[tuple[int, int, int], np.ndarray] = {}
        self._triple_pos: dict[tuple[int, int, int], dict[str, np.ndarray]] = {}
        bh_cols = []
        for close in panel.closes.values():
            rets = np.diff(close) / np.where(close[:-1] == 0, np.nan, close[:-1])
            bh_cols.append(np.nan_to_num(rets, nan=0.0))
        self.buyhold = _panel_mean(bh_cols)

    def triple_frame(self, fast: int, slow: int, signal: int) -> tuple[np.ndarray, dict[str, np.ndarray]]:
        key = (int(fast), int(slow), int(signal))
        if key in self._triple_ret:
            return self._triple_ret[key], self._triple_pos[key]
        cols = []
        positions: dict[str, np.ndarray] = {}
        for ticker in self.panel.tickers:
            hist = self.cache.hist(ticker, key[0], key[1], key[2])
            pos = sign_position(hist)
            positions[ticker] = pos
            cols.append(next_bar_returns(self.panel.closes[ticker], pos))
        mean = _panel_mean(cols)
        self._triple_ret[key] = mean
        self._triple_pos[key] = positions
        return mean, positions

    def train_tpy(self, positions: dict[str, np.ndarray]) -> float:
        end = self.folds.train_end_close
        rates = [trades_per_year(pos[: end + 1], bars=end) for pos in positions.values()]
        return float(np.median(rates)) if rates else 0.0

    def sharpe_pair(self, strat: np.ndarray) -> tuple[float, float, float]:
        f = self.folds
        return (
            annualized_sharpe(strat[f.train]),
            annualized_sharpe(strat[f.valid]),
            annualized_sharpe(strat[f.lock]),
        )

    def fold_report(self, strat: np.ndarray, position: np.ndarray | None = None) -> dict[str, dict]:
        out = {}
        for name, sl in self.folds.as_dict().items():
            pos = None if position is None else position[sl]
            out[name] = _metrics(strat[sl], pos if pos is not None else np.ones(sl.stop - sl.start))
        return out

    def ensemble_frame(
        self, params: Sequence[Mapping[str, int]], long_th: float, short_th: float
    ) -> tuple[np.ndarray, np.ndarray]:
        """Equal-weight ensemble return, and the net book side aligned to those returns."""
        cols = []
        sides = []
        for ticker in self.panel.tickers:
            hists = [
                self.cache.hist(ticker, int(p["fast"]), int(p["slow"]), int(p["signal"]))
                for p in params
            ]
            pos = ensemble_position(hists, long_th, short_th)
            cols.append(next_bar_returns(self.panel.closes[ticker], pos))
            sides.append(pos[:-1])
        book = np.sign(_panel_mean(sides))
        return _panel_mean(cols), book


def _key(p: Mapping[str, int]) -> tuple[int, int, int]:
    return int(p["fast"]), int(p["slow"]), int(p["signal"])


def score_param_list(
    ev: StudyEvaluator,
    params: Sequence[Mapping[str, int]],
    *,
    floor: float,
    n_neighbors: int = 10,
) -> dict:
    """Stability gate. OOS Sharpe is the validation fold. Lock is not read."""
    usable: list[dict] = []
    is_s: list[float] = []
    va_s: list[float] = []
    for p in params:
        strat, positions = ev.triple_frame(int(p["fast"]), int(p["slow"]), int(p["signal"]))
        if ev.train_tpy(positions) < MIN_TRADES_PER_YEAR:
            continue
        tr = annualized_sharpe(strat[ev.folds.train])
        va = annualized_sharpe(strat[ev.folds.valid])
        usable.append({"fast": int(p["fast"]), "slow": int(p["slow"]), "signal": int(p["signal"])})
        is_s.append(tr)
        va_s.append(va)
    if not usable:
        return {"floor": floor, "n_qualified": 0, "n_scored": 0, "best": None, "ranked": []}
    selection = score_candidates(
        usable, is_s, va_s, is_sharpe_floor=floor, n_neighbors=min(n_neighbors, max(len(usable) - 1, 1))
    )
    ranked = sorted(
        (
            {
                "params": dict(c.params),
                "is_sharpe": round(c.is_sharpe, 4),
                "valid_sharpe": round(c.oos_sharpe, 4),
                "neighbor_valid_std": round(c.neighbor_oos_std, 4),
            }
            for c in selection.qualified
        ),
        key=lambda r: (r["neighbor_valid_std"], -r["valid_sharpe"]),
    )
    best = None
    if selection.best is not None:
        b = selection.best
        best = {
            "params": {k: int(v) for k, v in b.params.items()},
            "is_sharpe": round(b.is_sharpe, 4),
            "valid_sharpe": round(b.oos_sharpe, 4),
            "neighbor_valid_std": round(b.neighbor_oos_std, 4),
        }
    return {
        "floor": floor,
        "n_qualified": len(selection.qualified),
        "n_scored": len(usable),
        "best": best,
        "ranked": ranked[:12],
    }


def validation_table(ev: StudyEvaluator, params: Sequence[Mapping[str, int]]) -> list[dict]:
    """Train/validation Sharpes only. The locked fold is intentionally absent."""
    rows = []
    for p in params:
        strat, positions = ev.triple_frame(int(p["fast"]), int(p["slow"]), int(p["signal"]))
        tpy = ev.train_tpy(positions)
        tr = annualized_sharpe(strat[ev.folds.train])
        va = annualized_sharpe(strat[ev.folds.valid])
        rows.append(
            {
                "fast": int(p["fast"]),
                "slow": int(p["slow"]),
                "signal": int(p["signal"]),
                "train_sharpe": round(tr, 4),
                "valid_sharpe": round(va, 4),
                "train_tpy": round(tpy, 2),
                "kept": tpy >= MIN_TRADES_PER_YEAR,
            }
        )
    rows.sort(key=lambda r: r["valid_sharpe"], reverse=True)
    return rows


def _tpe_pick(
    trials: list[tuple[dict[str, int], float]],
    space: dict[str, list[int]],
    rng: np.random.Generator,
    gamma: float = 0.25,
) -> dict[str, int]:
    """One independent TPE draw. Good = top `gamma` fraction of the objective."""
    scores = np.array([s for _, s in trials], dtype=float)
    order = np.argsort(scores)
    n_good = max(1, int(np.ceil(gamma * len(trials))))
    good_idx = set(order[-n_good:].tolist())
    proposal: dict[str, int] = {}
    for name, values in space.items():
        grid = np.asarray(values, dtype=float)
        good = np.array([float(trials[i][0][name]) for i in good_idx], dtype=float)
        bad = np.array([float(trials[i][0][name]) for i in range(len(trials)) if i not in good_idx], dtype=float)
        def dens(samples: np.ndarray) -> np.ndarray:
            if samples.size == 0:
                return np.ones(grid.size) / grid.size
            bw = max(float(np.std(samples)), 1.0)
            z = (grid[None, :] - samples[:, None]) / bw
            d = np.exp(-0.5 * z * z).sum(axis=0)
            return d / (d.sum() + 1e-12)
        ratio = dens(good) / np.maximum(dens(bad), 1e-12)
        # Mixture with a uniform so a thin kernel cannot freeze the search.
        prob = 0.85 * (ratio / ratio.sum()) + 0.15 * (np.ones(grid.size) / grid.size)
        prob = prob / prob.sum()
        proposal[name] = int(rng.choice(values, p=prob))
    return proposal


def tpe_search(
    objective: Callable[[Mapping[str, int]], float],
    *,
    n_trials: int = TPE_TRIALS,
    n_startup: int = TPE_STARTUP,
    seed: int = 7,
) -> list[dict]:
    """Maximise `objective` over fast 5–20, slow 21–100, signal ∈ {5, 9, 12}.

    Samples with slow < fast + 8 are rejected. The objective sees train data
    only; this function does not know about validation or the locked fold.
    """
    rng = np.random.default_rng(seed)
    space = {
        "fast": list(range(5, 21)),
        "slow": list(range(21, 101)),
        "signal": [5, 9, 12],
    }
    trials: list[tuple[dict[str, int], float]] = []
    seen: set[tuple[int, int, int]] = set()

    def draw_random() -> dict[str, int]:
        for _ in range(40):
            p = {k: int(rng.choice(v)) for k, v in space.items()}
            if p["slow"] >= p["fast"] + FAST_GAP and _key(p) not in seen:
                return p
        # Fallback: first unused legal point in a fixed scan.
        for fast in space["fast"]:
            for slow in space["slow"]:
                if slow < fast + FAST_GAP:
                    continue
                for signal in space["signal"]:
                    p = {"fast": fast, "slow": slow, "signal": signal}
                    if _key(p) not in seen:
                        return p
        raise RuntimeError("TPE space exhausted")

    target = max(n_trials, 1)
    startup = min(n_startup, target)
    guard = 0
    while len(trials) < target and guard < target * 8:
        guard += 1
        if len(trials) < startup:
            params = draw_random()
        else:
            params = _tpe_pick(trials, space, rng)
            if params["slow"] < params["fast"] + FAST_GAP or _key(params) in seen:
                params = draw_random()
        seen.add(_key(params))
        value = float(objective(params))
        trials.append((params, value))
    ranked = sorted(trials, key=lambda t: t[1], reverse=True)
    return [
        {"fast": p["fast"], "slow": p["slow"], "signal": p["signal"], "train_sharpe": round(s, 4)}
        for p, s in ranked
    ]


def neighbor_cloud(seeds: Sequence[Mapping[str, int]], width_fast: int = 2, width_slow: int = 5) -> list[dict[str, int]]:
    """Integer neighborhood around each seed: fast ± 2, slow ± 5, same signal."""
    cloud: dict[tuple[int, int, int], dict[str, int]] = {}
    for seed in seeds:
        fast0, slow0, sig = int(seed["fast"]), int(seed["slow"]), int(seed["signal"])
        for df in range(-width_fast, width_fast + 1):
            for ds in range(-width_slow, width_slow + 1):
                fast = fast0 + df
                slow = slow0 + ds
                if not (5 <= fast <= 20 and 21 <= slow <= 100):
                    continue
                if slow < fast + FAST_GAP:
                    continue
                if sig not in (5, 9, 12):
                    continue
                cloud[(fast, slow, sig)] = {"fast": fast, "slow": slow, "signal": sig}
    return list(cloud.values())


def _ensemble_block(ev: StudyEvaluator, params: Sequence[Mapping[str, int]], long_th: float, short_th: float) -> dict:
    strat, book = ev.ensemble_frame(params, long_th, short_th)
    report = ev.fold_report(strat, book)
    tr, va, lock = ev.sharpe_pair(strat)
    return {
        "n_cfg": len(params),
        "long_th": long_th,
        "short_th": short_th,
        "train_sharpe": round(tr, 4),
        "valid_sharpe": round(va, 4),
        "lock_sharpe": round(lock, 4),
        "folds": report,
        "params": [{k: int(p[k]) for k in ("fast", "slow", "signal")} for p in params],
    }


def _rule_table(ev: StudyEvaluator, params: Sequence[Mapping[str, int]]) -> tuple[list[dict], dict]:
    """Score threshold rules on validation. Locked numbers are attached after the choice."""
    scored = []
    for name, long_th, short_th in THRESHOLD_RULES:
        block = _ensemble_block(ev, params, long_th, short_th)
        scored.append({"rule": name, **{k: block[k] for k in ("long_th", "short_th", "train_sharpe", "valid_sharpe", "lock_sharpe", "folds")}})
    chosen = max(scored, key=lambda r: r["valid_sharpe"])
    return scored, chosen


def run_study(
    panel: ClosePanel,
    *,
    n_trials: int = TPE_TRIALS,
    n_startup: int = TPE_STARTUP,
    seed: int = 7,
    grid: Sequence[Mapping[str, int]] | None = None,
) -> dict:
    ev = StudyEvaluator(panel)
    grid_params = [dict(p) for p in (grid if grid is not None else default_param_grid())]
    table = validation_table(ev, grid_params)
    kept = [r for r in table if r["kept"]]
    official = score_param_list(ev, grid_params, floor=IS_SHARPE_FLOOR)
    diag_floor = 0.0
    if kept:
        diag_floor = float(np.quantile([r["train_sharpe"] for r in kept], 0.75))
    diagnostic = score_param_list(ev, grid_params, floor=diag_floor)

    def train_objective(p: Mapping[str, int]) -> float:
        strat, positions = ev.triple_frame(int(p["fast"]), int(p["slow"]), int(p["signal"]))
        if ev.train_tpy(positions) < MIN_TRADES_PER_YEAR:
            return -1.0
        return float(annualized_sharpe(strat[ev.folds.train]))

    bayes_trials = tpe_search(train_objective, n_trials=n_trials, n_startup=n_startup, seed=seed)
    seeds = bayes_trials[:5]
    cloud = neighbor_cloud(seeds)
    bayes_gate = score_param_list(ev, cloud, floor=IS_SHARPE_FLOOR, n_neighbors=10)
    prod = production_params()
    prod_gate = score_param_list(ev, prod, floor=-10.0, n_neighbors=max(len(prod) - 1, 1))
    prod_std = None if prod_gate["best"] is None else prod_gate["best"]["neighbor_valid_std"]

    prod_ens = _ensemble_block(ev, prod, ENSEMBLE_LONG, ENSEMBLE_SHORT)
    rules, chosen_rule = _rule_table(ev, prod)
    swing_cols = []
    swing_sides = []
    for ticker in ev.panel.tickers:
        pos = tema_position_series(ev.panel.closes[ticker])
        swing_cols.append(next_bar_returns(ev.panel.closes[ticker], pos))
        swing_sides.append(pos[:-1])
    swing = ev.fold_report(_panel_mean(swing_cols), np.sign(_panel_mean(swing_sides)))
    bh = ev.fold_report(ev.buyhold)

    # Validation-best single triple from the research menu. Selection ignores lock.
    selectable = kept or table
    best_valid = max(selectable, key=lambda r: r["valid_sharpe"])
    best_valid_strat, _pos = ev.triple_frame(best_valid["fast"], best_valid["slow"], best_valid["signal"])
    _tr, _va, best_valid_lock = ev.sharpe_pair(best_valid_strat)
    best_train = bayes_trials[0]
    best_train_strat, _pos = ev.triple_frame(best_train["fast"], best_train["slow"], best_train["signal"])
    _tr, best_train_valid, best_train_lock = ev.sharpe_pair(best_train_strat)

    promoted_params = None
    bayes_ens = None
    decision = "KEEP"
    reason = "no candidate cleared IS Sharpe > 1.0 with a tighter validation neighborhood and a better locked fold"
    if bayes_gate["best"] is not None and prod_std is not None:
        # Ensemble of the qualified cloud, capped at the six tightest.
        qualified = bayes_gate["ranked"][:6]
        promoted_params = [q["params"] for q in qualified]
        bayes_ens = _ensemble_block(ev, promoted_params, ENSEMBLE_LONG, ENSEMBLE_SHORT)
        tighter = bayes_gate["best"]["neighbor_valid_std"] < prod_std
        lock_ok = bayes_ens["lock_sharpe"] > 0 and bayes_ens["lock_sharpe"] >= prod_ens["lock_sharpe"]
        if tighter and lock_ok:
            decision = "PROMOTE"
            reason = "validation neighborhood is tighter than the production six and the locked fold holds up"
        elif not tighter:
            reason = "candidate neighborhood is not tighter than the production six on the validation fold"
        else:
            reason = "locked fold does not beat the production ensemble"

    dates = ev.panel.dates
    ret_index = dates[1:]
    def span(sl: slice) -> list[str]:
        return [str(ret_index[sl.start].date()), str(ret_index[sl.stop - 1].date())]

    return {
        "universe": list(ev.panel.tickers),
        "start": str(dates[0].date()),
        "end": str(dates[-1].date()),
        "n_bars": int(len(dates)),
        "folds": {
            "train": span(ev.folds.train),
            "valid": span(ev.folds.valid),
            "lock": span(ev.folds.lock),
        },
        "grid_n": len(grid_params),
        "grid_kept": len(kept),
        "official_gate": {k: official[k] for k in ("floor", "n_qualified", "n_scored", "best")},
        "diagnostic_gate": {
            "floor": round(diagnostic["floor"], 4),
            "n_qualified": diagnostic["n_qualified"],
            "best": diagnostic["best"],
        },
        "validation_top": [r for r in table if r["kept"]][:10],
        "production_gate": {
            "neighbor_valid_std": prod_std,
            "best": prod_gate["best"],
        },
        "production_ensemble": prod_ens,
        "threshold_rules": rules,
        "threshold_chosen_on_valid": chosen_rule["rule"],
        "buyhold": bh,
        "swing_9_99_199": swing,
        "validation_best_triple": {
            "fast": best_valid["fast"],
            "slow": best_valid["slow"],
            "signal": best_valid["signal"],
            "train_sharpe": best_valid["train_sharpe"],
            "valid_sharpe": best_valid["valid_sharpe"],
            "lock_sharpe": round(best_valid_lock, 4),
        },
        "bayes": {
            "n_trials": len(bayes_trials),
            "best_train": best_train,
            "best_train_valid_sharpe": round(best_train_valid, 4),
            "best_train_lock_sharpe": round(best_train_lock, 4),
            "cloud_n": len(cloud),
            "gate": {k: bayes_gate[k] for k in ("floor", "n_qualified", "n_scored", "best")},
            "ensemble": bayes_ens,
        },
        "decision": decision,
        "reason": reason,
    }


def format_report(result: dict) -> str:
    def fold_line(title: str, folds: dict, name: str) -> str:
        m = folds[name]
        return (
            f"  {title:<22} {name:<5} Sharpe={m['sharpe']:7.3f}  "
            f"CAGR={m['cagr']*100:7.2f}%  MaxDD={m['max_drawdown']*100:7.2f}%  "
            f"Return={m['total_return']*100:8.2f}%"
        )

    lines = [
        "TEMA-MACD ENSEMBLE SEARCH",
        f"Universe: {', '.join(result['universe'])}  {result['start']} → {result['end']}  ({result['n_bars']} bars)",
        f"Train {result['folds']['train'][0]} → {result['folds']['train'][1]}",
        f"Valid {result['folds']['valid'][0]} → {result['folds']['valid'][1]}",
        f"Lock  {result['folds']['lock'][0]} → {result['folds']['lock'][1]}",
        f"Grid {result['grid_n']} triples, {result['grid_kept']} passed the 2 trades/year filter",
        f"Official gate (IS Sharpe > {result['official_gate']['floor']}): "
        f"qualified {result['official_gate']['n_qualified']}",
        f"Decision: {result['decision']}. {result['reason']}",
        "",
        "Locked fold (chosen without seeing these numbers)",
    ]
    for label, block, key in (
        ("buy-hold", result["buyhold"], None),
        ("swing 9/99/199", result["swing_9_99_199"], None),
    ):
        lines.append(fold_line(label, block, "lock"))
    prod = result["production_ensemble"]["folds"]
    lines.append(fold_line("ensemble production", prod, "lock"))
    chosen = result["threshold_chosen_on_valid"]
    for rule in result["threshold_rules"]:
        mark = " ← valid" if rule["rule"] == chosen else ""
        lines.append(
            f"  threshold {rule['rule']:<12} lock Sharpe={rule['lock_sharpe']:7.3f}  "
            f"valid Sharpe={rule['valid_sharpe']:7.3f}{mark}"
        )
    vb = result["validation_best_triple"]
    lines.append(
        f"  valid-best triple    ({vb['fast']},{vb['slow']},{vb['signal']})  "
        f"train={vb['train_sharpe']:.3f} valid={vb['valid_sharpe']:.3f} lock={vb['lock_sharpe']:.3f}"
    )
    bt = result["bayes"]["best_train"]
    lines.append(
        f"  bayes train-best     ({bt['fast']},{bt['slow']},{bt['signal']})  "
        f"train={bt['train_sharpe']:.3f} valid={result['bayes']['best_train_valid_sharpe']:.3f} "
        f"lock={result['bayes']['best_train_lock_sharpe']:.3f}"
    )
    lines.append("")
    lines.append("Top validation triples (lock hidden)")
    for row in result["validation_top"][:8]:
        lines.append(
            f"  ({row['fast']:>2},{row['slow']:>3},{row['signal']:>2})  "
            f"train={row['train_sharpe']:7.3f}  valid={row['valid_sharpe']:7.3f}  "
            f"tpy={row['train_tpy']:.1f}"
        )
    return "\n".join(lines)


def run_market(
    tickers: Sequence[str] = DEFAULT_TICKERS,
    start: str = DEFAULT_START,
    n_trials: int = TPE_TRIALS,
    seed: int = 7,
) -> dict:
    series: dict[str, pd.Series] = {}
    for t in tickers:
        series[t] = download_close(t, start)
    panel = make_panel(series)
    return run_study(panel, n_trials=n_trials, seed=seed)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--tickers", default=",".join(DEFAULT_TICKERS))
    p.add_argument("--start", default=DEFAULT_START)
    p.add_argument("--trials", type=int, default=TPE_TRIALS)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument(
        "--out",
        default="pipeline/research/artifacts/tema_ensemble_search.json",
    )
    args = p.parse_args(argv)
    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    result = run_market(tickers, start=args.start, n_trials=args.trials, seed=args.seed)
    text = format_report(result)
    print(text)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2))
    print(f"\nWrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
