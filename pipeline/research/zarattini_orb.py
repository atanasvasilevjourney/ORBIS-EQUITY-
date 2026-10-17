"""Zarattini & Aziz (2023) opening-bias backtest — adapted from giovannibrusco/zarattini-2023-orb-qqq (MIT).

Paper: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4416622
Original implementation: https://github.com/giovannibrusco/zarattini-2023-orb-qqq

Rules (5-minute bars, America/New_York):
  - Signal bar at 09:30: direction from open vs close (doji = skip).
  - Entry at 09:35 open; stop = 09:30 bar low (long) or high (short).
  - Target = entry ± 10R; exit stop-first intraday through 15:55, else session close.
  - Size: min(1% equity / R, 4× equity / entry price).
  - Optional confirmation: prior bar at 09:25 on a benchmark (NQ in paper; QQQ here).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import time
from typing import Literal

import pandas as pd

Direction = Literal["long", "short"]
ExitReason = Literal["stop", "target", "session_close"]

SIGNAL_TIME = time(9, 30)
ENTRY_TIME = time(9, 35)
CONFIRMATION_TIME = time(9, 25)
SESSION_END = time(15, 55)


@dataclass(frozen=True)
class BacktestConfig:
    initial_equity: float = 25_000.0
    risk_fraction: float = 0.01
    leverage_cap: float = 4.0
    reward_to_risk: float = 10.0
    entry_slippage_per_share: float = 0.0
    additional_stop_slippage_per_share: float = 0.0
    commission_per_share_per_side: float = 0.0
    require_confirmation: bool = False


@dataclass(frozen=True)
class Trade:
    symbol: str
    session_date: pd.Timestamp
    direction: Direction
    entry_time: pd.Timestamp
    exit_time: pd.Timestamp
    entry_price: float
    exit_price: float
    stop_price: float
    target_price: float
    shares: int
    exit_reason: ExitReason
    gross_pnl: float
    costs: float
    net_pnl: float
    equity_after: float

    @property
    def pnl_per_share(self) -> float:
        return self.net_pnl / self.shares if self.shares else 0.0


@dataclass(frozen=True)
class BacktestResult:
    symbol: str
    config: BacktestConfig
    trades: tuple[Trade, ...]

    @property
    def final_equity(self) -> float:
        if not self.trades:
            return self.config.initial_equity
        return self.trades[-1].equity_after


def _prepare_bars(bars: pd.DataFrame, label: str) -> pd.DataFrame:
    required = {"date", "open", "high", "low", "close"}
    missing = required.difference(bars.columns)
    if missing:
        raise ValueError(f"{label} missing columns: {sorted(missing)}")
    prepared = bars.copy()
    prepared["date"] = pd.to_datetime(prepared["date"])
    prepared = prepared.sort_values("date").reset_index(drop=True)
    if prepared["date"].duplicated().any():
        raise ValueError(f"{label} has duplicate timestamps")
    prepared["session_date"] = prepared["date"].dt.normalize()
    prepared["clock_time"] = prepared["date"].dt.time
    return prepared


def _row_at(session: pd.DataFrame, clock_time: time) -> pd.Series | None:
    rows = session.loc[session["clock_time"] == clock_time]
    if rows.empty:
        return None
    return rows.iloc[0]


def _row_at_or_after(session: pd.DataFrame, clock_time: time) -> pd.Series | None:
    """First bar at or after `clock_time` (Yahoo 5m often starts at 09:30, not 09:25)."""
    rows = session.loc[session["clock_time"] >= clock_time]
    if rows.empty:
        return None
    return rows.iloc[0]


def _direction(open_price: float, close_price: float) -> Direction | None:
    if close_price > open_price:
        return "long"
    if close_price < open_price:
        return "short"
    return None


def _position_size(equity: float, entry_price: float, risk_per_share: float, config: BacktestConfig) -> int:
    risk_budget_size = equity * config.risk_fraction / risk_per_share
    leverage_size = config.leverage_cap * equity / entry_price
    return max(0, int(min(risk_budget_size, leverage_size)))


def run_opening_bias_backtest(
    symbol: str,
    bars: pd.DataFrame,
    config: BacktestConfig | None = None,
    confirmation_bars: pd.DataFrame | None = None,
) -> BacktestResult:
    """Run opening-bias backtest on one symbol's 5m bars."""
    config = config or BacktestConfig()
    inst = _prepare_bars(bars, symbol)

    confirm = None
    if config.require_confirmation:
        if confirmation_bars is None:
            raise ValueError("confirmation_bars required when require_confirmation=True")
        confirm = _prepare_bars(confirmation_bars, "confirmation")

    equity = config.initial_equity
    completed: list[Trade] = []
    confirm_sessions = (
        {day: frame for day, frame in confirm.groupby("session_date", sort=True)} if confirm is not None else {}
    )

    for session_date, session in inst.groupby("session_date", sort=True):
        signal_bar = _row_at(session, SIGNAL_TIME)
        entry_bar = _row_at(session, ENTRY_TIME)
        if signal_bar is None or entry_bar is None:
            continue

        direction = _direction(float(signal_bar["open"]), float(signal_bar["close"]))
        if direction is None:
            continue

        if config.require_confirmation:
            c_session = confirm_sessions.get(session_date)
            if c_session is None:
                continue
            c_bar = _row_at(c_session, CONFIRMATION_TIME) or _row_at_or_after(
                c_session, CONFIRMATION_TIME
            )
            if c_bar is None:
                continue
            c_dir = _direction(float(c_bar["open"]), float(c_bar["close"]))
            if c_dir != direction:
                continue

        entry_price = float(entry_bar["open"])
        if direction == "long":
            stop_price = float(signal_bar["low"])
            risk_per_share = entry_price - stop_price
            target_price = entry_price + config.reward_to_risk * risk_per_share
        else:
            stop_price = float(signal_bar["high"])
            risk_per_share = stop_price - entry_price
            target_price = entry_price - config.reward_to_risk * risk_per_share

        if risk_per_share <= 0:
            continue

        shares = _position_size(equity, entry_price, risk_per_share, config)
        if shares < 1:
            continue

        path = session.loc[(session["date"] >= entry_bar["date"]) & (session["clock_time"] <= SESSION_END)]
        if path.empty:
            continue

        final_bar = path.iloc[-1]
        exit_price = float(final_bar["close"])
        exit_time = pd.Timestamp(final_bar["date"])
        exit_reason: ExitReason = "session_close"

        for _, bar in path.iterrows():
            if direction == "long":
                stop_hit = float(bar["low"]) <= stop_price
                target_hit = float(bar["high"]) >= target_price
            else:
                stop_hit = float(bar["high"]) >= stop_price
                target_hit = float(bar["low"]) <= target_price
            if stop_hit:
                exit_price = stop_price
                exit_time = pd.Timestamp(bar["date"])
                exit_reason = "stop"
                break
            if target_hit:
                exit_price = target_price
                exit_time = pd.Timestamp(bar["date"])
                exit_reason = "target"
                break

        gross_pnl = (exit_price - entry_price) * shares if direction == "long" else (entry_price - exit_price) * shares
        per_share_cost = config.entry_slippage_per_share + 2 * config.commission_per_share_per_side
        if exit_reason == "stop":
            per_share_cost += config.additional_stop_slippage_per_share
        costs = per_share_cost * shares
        net_pnl = gross_pnl - costs
        equity += net_pnl

        completed.append(
            Trade(
                symbol=symbol,
                session_date=pd.Timestamp(session_date),
                direction=direction,
                entry_time=pd.Timestamp(entry_bar["date"]),
                exit_time=exit_time,
                entry_price=entry_price,
                exit_price=exit_price,
                stop_price=stop_price,
                target_price=target_price,
                shares=shares,
                exit_reason=exit_reason,
                gross_pnl=gross_pnl,
                costs=costs,
                net_pnl=net_pnl,
                equity_after=equity,
            )
        )

    return BacktestResult(symbol=symbol, config=config, trades=tuple(completed))


def trades_to_frame(trades: tuple[Trade, ...]) -> pd.DataFrame:
    if not trades:
        return pd.DataFrame()
    rows = []
    for t in trades:
        row = {f.name: getattr(t, f.name) for f in t.__dataclass_fields__.values()}  # type: ignore[attr-defined]
        row["pnl_per_share"] = t.pnl_per_share
        rows.append(row)
    return pd.DataFrame(rows)


def equity_curve_from_trades(
    trades: tuple[Trade, ...],
    initial_equity: float,
    calendar: pd.DatetimeIndex,
) -> pd.Series:
    """Daily equity on `calendar` from session net PnL."""
    eq = pd.Series(float(initial_equity), index=calendar, dtype=float)
    if not trades:
        return eq
    df = trades_to_frame(trades)
    daily = df.groupby(df["session_date"].astype("datetime64[ns]").dt.normalize())["net_pnl"].sum()
    running = float(initial_equity)
    for day in calendar:
        ts = pd.Timestamp(day).normalize()
        if ts in daily.index:
            running += float(daily.loc[ts])
        eq.loc[day] = running
    return eq


def portfolio_equity_curve(
    all_trades: pd.DataFrame,
    initial_total: float,
    calendar: pd.DatetimeIndex,
) -> pd.Series:
    """Combined book: sum daily net PnL across symbols."""
    eq = pd.Series(float(initial_total), index=calendar, dtype=float)
    if all_trades.empty:
        return eq
    daily = all_trades.groupby(all_trades["session_date"].astype("datetime64[ns]").dt.normalize())["net_pnl"].sum()
    running = float(initial_total)
    for day in calendar:
        ts = pd.Timestamp(day).normalize()
        if ts in daily.index:
            running += float(daily.loc[ts])
        eq.loc[day] = running
    return eq


def performance_summary(trades: pd.DataFrame, initial_equity: float, final_equity: float) -> dict:
    import numpy as np

    if trades.empty:
        return {
            "trades": 0,
            "net_pnl": 0.0,
            "final_equity": initial_equity,
            "win_rate": float("nan"),
            "mean_pnl_per_share": float("nan"),
            "sharpe_daily": float("nan"),
            "max_drawdown": 0.0,
        }
    daily = trades.groupby("session_date")["net_pnl"].sum()
    eq = initial_equity + daily.cumsum()
    rets = eq.pct_change().dropna()
    sharpe = float(np.sqrt(252) * rets.mean() / rets.std(ddof=1)) if len(rets) > 1 and rets.std() > 0 else float("nan")
    dd = float((eq / eq.cummax() - 1).min())
    wins = (trades["net_pnl"] > 0).mean()
    return {
        "trades": len(trades),
        "net_pnl": float(trades["net_pnl"].sum()),
        "final_equity": final_equity,
        "win_rate": float(wins),
        "mean_pnl_per_share": float(trades["pnl_per_share"].mean()),
        "sharpe_daily": sharpe,
        "max_drawdown": dd,
        "stop_pct": float((trades["exit_reason"] == "stop").mean()),
        "target_pct": float((trades["exit_reason"] == "target").mean()),
        "close_pct": float((trades["exit_reason"] == "session_close").mean()),
    }
