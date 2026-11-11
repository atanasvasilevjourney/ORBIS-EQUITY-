"""TEMA span search on the top equities: brute-force grid, then Optuna.

The grid enumerates a fixed set of TEMA lengths. Optuna's TPE sampler then
searches a wider integer box, seeded with the best grid points. The target
is annualized Sharpe of an equal-weight book after 10 bps a side.

Train is the first 60% of sessions. Optuna only sees that window. The last
40% is reported afterwards. A trial is eligible when both windows still have
40 sessions and the train window has at least 25 round trips. Spans that
consume the train window (TEMA-199 on this tape) stay in the report as a
baseline and do not enter the contest.

Nothing here writes production constants. Promotion still goes through
``param_stability.score_candidates`` and a Sharpe floor of 1.

Usage:
    PYTHONPATH=/workspace python -m pipeline.research.tema_search
"""
from __future__ import annotations

import argparse
import json
import logging
import os
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from pipeline.compute.kama_regime import (
    KAMA_LONG_FAST,
    KAMA_LONG_N,
    KAMA_LONG_SLOW,
    calculate_kama,
)
from pipeline.compute.param_stability import (
    DEFAULT_IS_SHARPE_FLOOR,
    annualized_sharpe,
    score_candidates,
)
from pipeline.compute.perps_math import (
    MACD_FAST,
    MACD_SIGNAL,
    MACD_SLOW,
    TEMA_FAST,
    TEMA_MID,
    TEMA_SLOW,
    macd,
    tema,
)
from pipeline.research.validation.metrics import apply_turnover, spell_returns

logger = logging.getLogger(__name__)

BARS_PER_YEAR = 252.0
TRAIN_FRACTION = 0.60
MIN_WINDOW_DAYS = 40
MIN_IS_TRADES = 25
INELIGIBLE_OBJECTIVE = -5.0
GRID_FAST = (5, 8, 9, 12, 15)
GRID_MID = (21, 34, 50, 89, 99)
GRID_SLOW = (60, 90, 120, 150)
PARAM_KEYS = (
    "fast",
    "mid",
    "slow",
    "macd_fast",
    "macd_slow",
    "macd_signal",
    "kama_gate",
)


@dataclass(frozen=True)
class TemaParams:
    fast: int
    mid: int
    slow: int
    macd_fast: int = MACD_FAST
    macd_slow: int = MACD_SLOW
    macd_signal: int = MACD_SIGNAL
    kama_gate: int = 1

    def as_floats(self) -> dict[str, float]:
        return {key: float(getattr(self, key)) for key in PARAM_KEYS}


def production_params() -> TemaParams:
    return TemaParams(
        fast=TEMA_FAST,
        mid=TEMA_MID,
        slow=TEMA_SLOW,
        macd_fast=MACD_FAST,
        macd_slow=MACD_SLOW,
        macd_signal=MACD_SIGNAL,
        kama_gate=1,
    )


def brute_force_grid() -> list[TemaParams]:
    """Every ordered (fast, mid, slow) on the fixed grid, gate on and off."""
    rows: list[TemaParams] = []
    for slow in GRID_SLOW:
        for mid in GRID_MID:
            if mid >= slow:
                continue
            for fast in GRID_FAST:
                if fast >= mid:
                    continue
                for gate in (0, 1):
                    rows.append(TemaParams(fast=fast, mid=mid, slow=slow, kama_gate=gate))
    return rows


def company_key(name: str | None, symbol: str) -> str:
    """Collapse share classes so GOOGL and GOOG count as one company."""
    text = str(name or symbol).lower()
    text = text.split(" - ")[0]
    text = text.split(" class ")[0]
    return " ".join(text.split())


def rank_equity_symbols(rows: list[dict], n: int = 100) -> list[str]:
    """One listing per company, then the n largest market caps."""
    best: dict[str, tuple[float, str]] = {}
    for row in rows:
        symbol = row.get("symbol")
        if not symbol:
            continue
        try:
            cap = float(row.get("market_cap"))
        except (TypeError, ValueError):
            continue
        if not np.isfinite(cap) or cap <= 0:
            continue
        company = company_key(row.get("company_name"), str(symbol))
        held = best.get(company)
        if held is None or cap > held[0]:
            best[company] = (cap, str(symbol))
    ordered = sorted(best.values(), key=lambda item: item[0], reverse=True)
    return [symbol for _cap, symbol in ordered[:n]]


def max_eligible_slow(n_dates: int) -> int:
    """Largest slow span that still leaves 40 scored sessions in the train window."""
    split = int(n_dates * TRAIN_FRACTION)
    return max(40, split - MIN_WINDOW_DAYS - 1)


class ClosePanel:
    """Aligned closes for one equal-weight book. Rows are symbols."""

    def __init__(self, symbols: list[str], dates: pd.DatetimeIndex, closes: np.ndarray):
        if closes.ndim != 2:
            raise ValueError("closes must be (symbols, dates)")
        if closes.shape[0] != len(symbols) or closes.shape[1] != len(dates):
            raise ValueError("closes shape does not match symbols and dates")
        if not np.isfinite(closes).all() or (closes <= 0).any():
            raise ValueError("closes must be finite and positive")
        self.symbols = list(symbols)
        self.dates = pd.DatetimeIndex(dates)
        self.closes = np.asarray(closes, dtype=float)
        self.rets = np.full(self.closes.shape, np.nan)
        prev = self.closes[:, :-1]
        self.rets[:, 1:] = self.closes[:, 1:] / prev - 1.0
        self.kama_bull = self._kama_bull()
        self.split = int(self.closes.shape[1] * TRAIN_FRACTION)
        self._tema: dict[tuple[int, int], np.ndarray] = {}
        self._macd: dict[tuple[int, int, int, int], tuple[np.ndarray, np.ndarray]] = {}

    @property
    def n_symbols(self) -> int:
        return int(self.closes.shape[0])

    @property
    def n_dates(self) -> int:
        return int(self.closes.shape[1])

    def _kama_bull(self) -> np.ndarray:
        bull = np.zeros(self.closes.shape, dtype=bool)
        for i in range(self.n_symbols):
            series = pd.Series(self.closes[i])
            kline = calculate_kama(
                series, n=KAMA_LONG_N, fast=KAMA_LONG_FAST, slow=KAMA_LONG_SLOW
            ).to_numpy(dtype=float)
            prior_close = np.roll(self.closes[i], 1)
            prior_k = np.roll(kline, 1)
            ok = np.isfinite(prior_close) & np.isfinite(prior_k)
            bull[i, 1:] = ok[1:] & (prior_close[1:] > prior_k[1:])
        return bull

    def tema_row(self, symbol_i: int, span: int) -> np.ndarray:
        key = (symbol_i, int(span))
        cached = self._tema.get(key)
        if cached is None:
            cached = tema(self.closes[symbol_i], int(span))
            self._tema[key] = cached
        return cached

    def macd_row(self, symbol_i: int, fast: int, slow: int, signal: int) -> tuple[np.ndarray, np.ndarray]:
        key = (symbol_i, int(fast), int(slow), int(signal))
        cached = self._macd.get(key)
        if cached is None:
            line, sig, _hist = macd(self.closes[symbol_i], int(fast), int(slow), int(signal))
            cached = (line, sig)
            self._macd[key] = cached
        return cached

    def signal(self, params: TemaParams, warmup: int | None = None) -> np.ndarray:
        """+1 / −1 / 0 at the close. ``warmup`` zeros every bar before that index."""
        fast_stack = np.vstack([self.tema_row(i, params.fast) for i in range(self.n_symbols)])
        mid_stack = np.vstack([self.tema_row(i, params.mid) for i in range(self.n_symbols)])
        slow_stack = np.vstack([self.tema_row(i, params.slow) for i in range(self.n_symbols)])
        lines = []
        sigs = []
        for i in range(self.n_symbols):
            line, sig = self.macd_row(i, params.macd_fast, params.macd_slow, params.macd_signal)
            lines.append(line)
            sigs.append(sig)
        line_stack = np.vstack(lines)
        sig_stack = np.vstack(sigs)
        last = self.closes
        side = np.zeros(last.shape, dtype=float)
        long = (last > slow_stack) & (fast_stack > mid_stack)
        short = (last < slow_stack) & (fast_stack < mid_stack)
        side[long] = 1.0
        side[short] = -1.0
        side[long & (line_stack <= sig_stack)] = 0.0
        side[short & (line_stack >= sig_stack)] = 0.0
        start = params.slow if warmup is None else int(warmup)
        if start > 0:
            side[:, :start] = 0.0
        if params.kama_gate:
            side[(side > 0) & ~self.kama_bull] = 0.0
            side[(side < 0) & self.kama_bull] = 0.0
        return side

    def book_returns(self, position: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Equal-weight daily book.

        Position at close t earns the return from t to t+1. Each name pays
        10 bps on the weight that changed. The book is the mean across names.
        """
        weight = np.zeros_like(position, dtype=float)
        weight[:, 1:] = position[:, :-1]
        earned = np.empty_like(weight)
        bar = np.nan_to_num(self.rets, nan=0.0)
        for i in range(self.n_symbols):
            earned[i] = apply_turnover(weight[i], bar[i])
        book = np.full(earned.shape[1], np.nan)
        book[1:] = np.mean(earned[:, 1:], axis=0)
        return book, weight


def panel_from_close_frame(frame: pd.DataFrame) -> ClosePanel:
    """Columns are symbols, the index is the session date. Drops incomplete columns."""
    data = frame.sort_index()
    data = data.dropna(axis=1, how="any")
    if data.shape[1] == 0 or data.shape[0] < 30:
        raise ValueError("need a date index and at least one complete symbol")
    symbols = [str(column) for column in data.columns]
    closes = np.ascontiguousarray(data.to_numpy(dtype=float).T)
    return ClosePanel(symbols, pd.DatetimeIndex(data.index), closes)


def equity_kpis(daily: np.ndarray, trades_pct: np.ndarray) -> dict[str, float]:
    """Sharpe is the optimized KPI. The rest is the equity card around it."""
    r = np.asarray(daily, dtype=float)
    r = r[np.isfinite(r)]
    blank = {
        "days": 0,
        "sharpe": 0.0,
        "sortino": 0.0,
        "cagr": 0.0,
        "total_return": 0.0,
        "max_drawdown": 0.0,
        "calmar": 0.0,
        "profit_factor": 0.0,
        "day_win_rate": 0.0,
        "n_trades": 0,
        "trade_win_rate": 0.0,
        "avg_trade": 0.0,
    }
    if len(r) < 2:
        return blank
    equity = np.cumprod(1.0 + r)
    years = max(len(r) / BARS_PER_YEAR, 1e-9)
    total = float(equity[-1] - 1.0)
    cagr = float(equity[-1] ** (1.0 / years) - 1.0) if equity[-1] > 0 else -1.0
    peak = np.maximum.accumulate(equity)
    drawdown = float(np.min(equity / peak - 1.0))
    downside = np.sqrt(float(np.mean(np.minimum(r, 0.0) ** 2)))
    sortino = 0.0 if downside <= 0 else float(np.mean(r) / downside * np.sqrt(BARS_PER_YEAR))
    gains = float(r[r > 0].sum())
    losses = float(-r[r < 0].sum())
    if losses > 0:
        profit_factor = gains / losses
    elif gains > 0:
        profit_factor = 99.0
    else:
        profit_factor = 0.0
    trades = np.asarray(trades_pct, dtype=float)
    trades = trades[np.isfinite(trades)]
    return {
        "days": int(len(r)),
        "sharpe": float(annualized_sharpe(r)),
        "sortino": sortino,
        "cagr": cagr,
        "total_return": total,
        "max_drawdown": drawdown,
        "calmar": float(cagr / abs(drawdown)) if drawdown < 0 else cagr,
        "profit_factor": float(profit_factor),
        "day_win_rate": float(np.mean(r > 0)),
        "n_trades": int(trades.size),
        "trade_win_rate": float(np.mean(trades > 0)) if trades.size else 0.0,
        "avg_trade": float(np.mean(trades) / 100.0) if trades.size else 0.0,
    }


def _trade_percents(weight: np.ndarray, rets: np.ndarray, start: int, end: int) -> np.ndarray:
    chunks = []
    bar = np.nan_to_num(rets[:, start:end], nan=0.0)
    held = weight[:, start:end]
    for i in range(held.shape[0]):
        chunks.append(spell_returns(held[i], bar[i]))
    if not chunks:
        return np.array([], dtype=float)
    return np.concatenate(chunks)


def _slice_bounds(n_dates: int, split: int, score_from: int) -> tuple[tuple[int, int], tuple[int, int]]:
    is_bounds = (score_from, split)
    oos_bounds = (max(score_from, split), n_dates)
    return is_bounds, oos_bounds


def evaluate(panel: ClosePanel, params: TemaParams, *, source: str, warmup: int | None = None) -> dict:
    position = panel.signal(params, warmup=warmup)
    daily, weight = panel.book_returns(position)
    score_from = (params.slow if warmup is None else int(warmup)) + 1
    is_bounds, oos_bounds = _slice_bounds(panel.n_dates, panel.split, score_from)
    row: dict = {"source": source, **asdict(params)}
    for label, (start, end) in (("is", is_bounds), ("oos", oos_bounds)):
        trades = _trade_percents(weight, panel.rets, start, end)
        kpis = equity_kpis(daily[start:end], trades)
        for key, value in kpis.items():
            row[f"{label}_{key}"] = value
        window_w = weight[:, start:end]
        row[f"{label}_exposure"] = float(np.mean(np.abs(window_w))) if window_w.size else 0.0
    is_days = int(row["is_days"])
    oos_days = int(row["oos_days"])
    row["eligible"] = bool(
        is_days >= MIN_WINDOW_DAYS
        and oos_days >= MIN_WINDOW_DAYS
        and int(row["is_n_trades"]) >= MIN_IS_TRADES
    )
    row["objective"] = float(row["is_sharpe"]) if row["eligible"] else INELIGIBLE_OBJECTIVE
    return row


def buyhold_row(panel: ClosePanel) -> dict:
    position = np.ones(panel.closes.shape, dtype=float)
    position[:, 0] = 0.0
    daily, weight = panel.book_returns(position)
    start = panel.split
    trades = _trade_percents(weight, panel.rets, start, panel.n_dates)
    kpis = equity_kpis(daily[start:], trades)
    row = {
        "source": "buyhold",
        "fast": 0,
        "mid": 0,
        "slow": 0,
        "macd_fast": 0,
        "macd_slow": 0,
        "macd_signal": 0,
        "kama_gate": 0,
        "eligible": False,
        "objective": 0.0,
    }
    for key, value in kpis.items():
        row[f"oos_{key}"] = value
        row[f"is_{key}"] = 0.0
    row["oos_exposure"] = 1.0
    row["is_exposure"] = 0.0
    return row


def run_grid(panel: ClosePanel) -> list[dict]:
    rows = []
    limit = max_eligible_slow(panel.n_dates)
    grid = [params for params in brute_force_grid() if params.slow <= limit]
    for i, params in enumerate(grid, start=1):
        rows.append(evaluate(panel, params, source="grid"))
        if i % 40 == 0 or i == len(grid):
            logger.info("Grid %d/%d", i, len(grid))
    return rows


def suggest_params(trial, slow_high: int) -> TemaParams:
    slow_high = max(60, int(slow_high))
    slow = trial.suggest_int("slow", 50, slow_high)
    mid = trial.suggest_int("mid", 16, slow - 8)
    fast = trial.suggest_int("fast", 4, mid - 4)
    macd_slow = trial.suggest_int("macd_slow", 18, 40)
    macd_fast = trial.suggest_int("macd_fast", 6, macd_slow - 6)
    macd_signal = trial.suggest_int("macd_signal", 5, 12)
    kama_gate = trial.suggest_categorical("kama_gate", [0, 1])
    return TemaParams(
        fast=fast,
        mid=mid,
        slow=slow,
        macd_fast=macd_fast,
        macd_slow=macd_slow,
        macd_signal=macd_signal,
        kama_gate=int(kama_gate),
    )


def run_optuna(panel: ClosePanel, n_trials: int, seed_rows: list[dict], seed: int) -> list[dict]:
    import optuna

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    slow_high = min(155, max_eligible_slow(panel.n_dates))
    sampler = optuna.samplers.TPESampler(seed=seed, n_startup_trials=12)
    study = optuna.create_study(direction="maximize", sampler=sampler)
    for row in seed_rows:
        study.enqueue_trial(
            {
                "slow": int(row["slow"]),
                "mid": int(row["mid"]),
                "fast": int(row["fast"]),
                "macd_slow": int(row["macd_slow"]),
                "macd_fast": int(row["macd_fast"]),
                "macd_signal": int(row["macd_signal"]),
                "kama_gate": int(row["kama_gate"]),
            }
        )

    def objective(trial: optuna.Trial) -> float:
        params = suggest_params(trial, slow_high)
        row = evaluate(panel, params, source="optuna")
        trial.set_user_attr("row", row)
        return float(row["objective"])

    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)
    rows = []
    for trial in study.trials:
        stored = trial.user_attrs.get("row")
        if stored is not None:
            rows.append(stored)
    return rows


def optimizer_pick(rows: list[dict]) -> dict | None:
    """The trial Optuna and the grid were allowed to crown: best train Sharpe."""
    eligible = [row for row in rows if row.get("eligible")]
    if not eligible:
        return None
    return max(
        eligible,
        key=lambda row: (
            float(row["is_sharpe"]),
            int(row["is_n_trades"]),
            -abs(float(row["is_max_drawdown"])),
        ),
    )


def stability_pick(rows: list[dict]) -> dict | None:
    """Promotion gate. None when no eligible trial clears the train Sharpe floor."""
    eligible = [row for row in rows if row.get("eligible")]
    if len(eligible) < 3:
        return None
    params = [TemaParams(
        fast=int(row["fast"]),
        mid=int(row["mid"]),
        slow=int(row["slow"]),
        macd_fast=int(row["macd_fast"]),
        macd_slow=int(row["macd_slow"]),
        macd_signal=int(row["macd_signal"]),
        kama_gate=int(row["kama_gate"]),
    ).as_floats() for row in eligible]
    selection = score_candidates(
        params,
        [float(row["is_sharpe"]) for row in eligible],
        [float(row["oos_sharpe"]) for row in eligible],
        is_sharpe_floor=DEFAULT_IS_SHARPE_FLOOR,
        n_neighbors=min(8, len(eligible) - 1),
        param_keys=PARAM_KEYS,
    )
    if selection.best is None:
        return None
    return eligible[selection.best.idx]


def _round_row(row: dict) -> dict:
    out = {}
    for key, value in row.items():
        if isinstance(value, float):
            out[key] = round(value, 4)
        else:
            out[key] = value
    return out


def summarize(panel: ClosePanel, rows: list[dict], buyhold: dict, production: dict) -> dict:
    chosen = optimizer_pick(rows)
    stable = stability_pick(rows)
    eligible = [row for row in rows if row.get("eligible")]
    best_oos = max(eligible, key=lambda row: float(row["oos_sharpe"])) if eligible else None
    return {
        "symbols": panel.symbols,
        "n_symbols": panel.n_symbols,
        "n_dates": panel.n_dates,
        "start": panel.dates[0].date().isoformat(),
        "end": panel.dates[-1].date().isoformat(),
        "train_end": panel.dates[panel.split - 1].date().isoformat(),
        "cost_bps_per_side": 10,
        "target": "annualized Sharpe of the equal-weight book",
        "is_sharpe_floor": DEFAULT_IS_SHARPE_FLOOR,
        "n_trials": len(rows),
        "n_eligible": len(eligible),
        "optimizer_pick": None if chosen is None else _round_row(chosen),
        "stability_pick": None if stable is None else _round_row(stable),
        "highest_oos": None if best_oos is None else _round_row(best_oos),
        "production": _round_row(production),
        "buyhold_oos": _round_row(buyhold),
    }


def save_figure(rows: list[dict], summary: dict, path: str) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    frame = pd.DataFrame(rows)
    fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.6))
    ax = axes[0]
    for source, color in (("grid", "#8aa0b4"), ("optuna", "#1f6feb")):
        part = frame[frame["source"] == source]
        part = part[part["eligible"] == True]  # noqa: E712
        ax.scatter(part["is_sharpe"], part["oos_sharpe"], s=18, alpha=0.75, c=color, label=source)
    ax.axhline(0, color="#999", lw=0.8)
    ax.axvline(0, color="#999", lw=0.8)
    pick = summary.get("optimizer_pick")
    prod = summary.get("production")
    if pick:
        ax.scatter([pick["is_sharpe"]], [pick["oos_sharpe"]], s=80, c="#d97706", zorder=3, label="optimizer")
    if prod:
        ax.scatter([prod["is_sharpe"]], [prod["oos_sharpe"]], s=80, marker="D", c="#b91c1c", zorder=3, label="9/99/199")
    ax.set_xlabel("Train Sharpe")
    ax.set_ylabel("Holdout Sharpe")
    ax.set_title("Eligible trials")
    ax.legend(frameon=False, fontsize=8)

    ax2 = axes[1]
    oos = frame.loc[frame["eligible"] == True, "oos_sharpe"]  # noqa: E712
    if len(oos):
        ax2.hist(oos, bins=18, color="#1f6feb", alpha=0.85)
    if pick:
        ax2.axvline(pick["oos_sharpe"], color="#d97706", lw=1.5, label="optimizer holdout")
    hold = summary.get("buyhold_oos", {})
    if hold:
        ax2.axvline(hold.get("oos_sharpe", 0.0), color="#15803d", lw=1.5, label="buy & hold")
    ax2.set_xlabel("Holdout Sharpe")
    ax2.set_ylabel("Trials")
    ax2.set_title("Holdout Sharpe of eligible spans")
    ax2.legend(frameon=False, fontsize=8)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def load_top_panel(n: int = 100):
    """Top listings by market cap, one share class per company, from Supabase."""
    from dotenv import load_dotenv
    from supabase import create_client

    from pipeline.utils.supabase import fetch_all

    load_dotenv()
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    sb = create_client(url, key)
    fundamentals = fetch_all(
        sb,
        "fundamentals_snapshot",
        "symbol,market_cap",
        order=("market_cap", True),
    )
    names = fetch_all(sb, "universe_members", "symbol,company_name")
    by_symbol = {row["symbol"]: row.get("company_name") for row in names if row.get("symbol")}
    joined = []
    for row in fundamentals:
        symbol = row.get("symbol")
        joined.append(
            {
                "symbol": symbol,
                "market_cap": row.get("market_cap"),
                "company_name": by_symbol.get(symbol) or symbol,
            }
        )
    symbols = rank_equity_symbols(joined, n)
    logger.info("Ranked %d symbols", len(symbols))
    prices = _fetch_prices(sb, symbols)
    frame = prices.pivot(index="date", columns="symbol", values="close").sort_index()
    frame.index = pd.to_datetime(frame.index)
    # Keep the ranked order and drop a name that does not cover the full calendar.
    ordered = [symbol for symbol in symbols if symbol in frame.columns]
    frame = frame[ordered]
    # The union of listing dates is longer than the calendar most names share.
    # Keep sessions where at least 90% of the book printed, then drop a name
    # that still has a hole on that calendar.
    present = frame.notna().sum(axis=1)
    core = present[present >= 0.9 * frame.shape[1]].index
    frame = frame.loc[core]
    frame = frame.dropna(axis=1, how="any")
    logger.info(
        "Panel %d symbols × %d sessions (%s → %s)",
        frame.shape[1],
        frame.shape[0],
        frame.index[0].date(),
        frame.index[-1].date(),
    )
    return panel_from_close_frame(frame)


def _fetch_prices(sb, symbols: list[str]) -> pd.DataFrame:
    rows: list[dict] = []
    for start in range(0, len(symbols), 20):
        chunk = symbols[start : start + 20]
        offset = 0
        while True:
            resp = (
                sb.table("prices_daily")
                .select("symbol,date,close")
                .in_("symbol", chunk)
                .order("symbol")
                .order("date")
                .range(offset, offset + 999)
                .execute()
            )
            batch = resp.data or []
            rows.extend(batch)
            if len(batch) < 1000:
                break
            offset += 1000
    frame = pd.DataFrame(rows)
    if frame.empty:
        raise RuntimeError("prices_daily returned no rows for the top symbols")
    frame["close"] = pd.to_numeric(frame["close"], errors="coerce")
    frame = frame.dropna(subset=["close"])
    frame = frame[frame["close"] > 0]
    return frame.drop_duplicates(["symbol", "date"], keep="last")


def _jsonable(summary: dict) -> dict:
    out = dict(summary)
    # The symbol list stays in the artifact. The console print uses the short card.
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="TEMA grid + Optuna Sharpe search")
    parser.add_argument("--top", type=int, default=100)
    parser.add_argument("--trials", type=int, default=80)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument(
        "--out",
        default="pipeline/research/artifacts",
        help="Directory for the CSV, JSON, and figure",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    panel = load_top_panel(args.top)
    logger.info("Brute-force grid")
    grid_rows = run_grid(panel)
    ranked = sorted(
        (row for row in grid_rows if row["eligible"]),
        key=lambda row: float(row["is_sharpe"]),
        reverse=True,
    )
    seeds = []
    seen = set()
    for row in ranked[:8]:
        key = (row["fast"], row["mid"], row["slow"], row["kama_gate"])
        if key in seen:
            continue
        seen.add(key)
        seeds.append(row)
    logger.info("Optuna TPE, %d trials, %d seeds", args.trials, len(seeds))
    optuna_rows = run_optuna(panel, args.trials, seeds, args.seed)
    production = evaluate(panel, production_params(), source="production")
    hold = buyhold_row(panel)
    searched = grid_rows + optuna_rows
    summary = summarize(panel, searched, hold, production)

    out_dir = args.out
    os.makedirs(out_dir, exist_ok=True)
    table = pd.DataFrame([_round_row(row) for row in searched + [production, hold]])
    csv_path = os.path.join(out_dir, "tema_sharpe_search.csv")
    json_path = os.path.join(out_dir, "tema_sharpe_search.json")
    fig_path = os.path.join(out_dir, "tema_sharpe_search.png")
    table.to_csv(csv_path, index=False)
    with open(json_path, "w", encoding="utf-8") as handle:
        json.dump(_jsonable(summary), handle, indent=2)
    save_figure(searched, summary, fig_path)
    logger.info("Wrote %s", json_path)
    pick = summary["optimizer_pick"]
    if pick:
        logger.info(
            "Optimizer TEMA %s/%s/%s gate %s  train Sharpe %.2f  holdout Sharpe %.2f",
            pick["fast"],
            pick["mid"],
            pick["slow"],
            pick["kama_gate"],
            pick["is_sharpe"],
            pick["oos_sharpe"],
        )
    else:
        logger.info("No eligible trial")
    logger.info(
        "Production holdout Sharpe %.2f  buy&hold holdout Sharpe %.2f",
        production["oos_sharpe"],
        hold["oos_sharpe"],
    )


if __name__ == "__main__":
    main()
