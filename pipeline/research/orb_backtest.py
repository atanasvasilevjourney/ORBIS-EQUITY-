"""Opening Range Breakout (ORB) — intraday backtest + parameter grid.

Faithful to ``pipeline.compute.opening_range`` rules, with tunable:
  - gap filter (%)
  - OR window length (minutes from 09:30 ET)
  - stop / target multiples of OR width (production default: 1R / 1R)

**Data limit:** Yahoo ``5m`` history is ~60 calendar days. Long IS/OOS splits from
other research notebooks do not apply here; use ``orb_sample_split()`` on the
available intraday window instead.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from typing import Iterable
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import yfinance as yf

from pipeline.compute.opening_range import (
    EQUITY as DEFAULT_EQUITY,
    GAP_PCT as DEFAULT_GAP_PCT,
    LIQUID,
    MAX_NAMES as DEFAULT_MAX_NAMES,
    MIN_PRICE as DEFAULT_MIN_PRICE,
    RISK_FRAC as DEFAULT_RISK_FRAC,
    _flatten_daily,
    _minutes,
    gap_pct,
)
from pipeline.research.donchian_vwap_backtest import PeriodMetrics, _metrics

NY = ZoneInfo("America/New_York")
OR_START_MIN = 9 * 60 + 30


@dataclass(frozen=True)
class OrbParams:
    gap_pct: float = DEFAULT_GAP_PCT
    or_minutes: int = 15
    stop_r: float = 1.0
    target_r: float = 1.0
    risk_frac: float = DEFAULT_RISK_FRAC
    max_names: int = DEFAULT_MAX_NAMES
    min_price: float = DEFAULT_MIN_PRICE
    long_only: bool = True
    equity: float = DEFAULT_EQUITY


@dataclass
class OrbTrade:
    session: date
    symbol: str
    gap_pct: float
    entry: float
    exit_px: float
    shares: int
    or_range: float
    stop: float
    target: float
    exit_reason: str
    r_multiple: float
    pnl: float
    pnl_pct_equity: float


def or_end_min(or_minutes: int) -> int:
    return OR_START_MIN + int(or_minutes)


def opening_range_with_params(
    bars: pd.DataFrame,
    session: date,
    *,
    or_minutes: int = 15,
) -> dict | None:
    """Same logic as ``opening_range.opening_range`` with configurable OR length."""
    if bars is None or bars.empty:
        return None
    df = bars.copy()
    df.columns = [str(c).title() for c in df.columns]
    if "Close" not in df.columns or "High" not in df.columns:
        return None
    idx = df.index
    if idx.tz is None:
        idx = idx.tz_localize("UTC")
    idx = idx.tz_convert(NY)
    df = df.copy()
    df.index = idx
    day = df[df.index.date == session]
    if day.empty:
        return None
    end_min = or_end_min(or_minutes)
    mins = pd.Series([_minutes(t) for t in day.index], index=day.index)
    or_bars = day[(mins >= OR_START_MIN) & (mins < end_min)]
    after = day[(mins >= end_min) & (mins < 16 * 60)]
    if or_bars.empty:
        return {
            "orHigh": None,
            "orLow": None,
            "orRange": None,
            "status": "NO_BARS",
            "entry": None,
            "breakoutAt": None,
        }
    or_high = float(or_bars["High"].max())
    or_low = float(or_bars["Low"].min())
    or_range = or_high - or_low
    brk = after[after["Close"] > or_high] if not after.empty else after
    if brk is None or brk.empty:
        return {
            "orHigh": or_high,
            "orLow": or_low,
            "orRange": or_range,
            "status": "NO_BREAK",
            "entry": None,
            "breakoutAt": None,
        }
    entry = float(brk["Close"].iloc[0])
    return {
        "orHigh": or_high,
        "orLow": or_low,
        "orRange": or_range,
        "status": "BREAKOUT",
        "entry": entry,
        "breakoutAt": brk.index[0],
    }


def _exit_long_intraday(
    bars: pd.DataFrame,
    session: date,
    entry_ts: pd.Timestamp,
    entry: float,
    stop: float,
    target: float,
) -> tuple[float, str]:
    """Walk 5m bars after entry; conservative stop-first if both touched."""
    df = bars.copy()
    df.columns = [str(c).title() for c in df.columns]
    idx = df.index
    if idx.tz is None:
        idx = idx.tz_localize("UTC")
    idx = idx.tz_convert(NY)
    df.index = idx
    day = df[df.index.date == session]
    after = day[day.index > entry_ts]
    for ts, row in after.iterrows():
        o = float(row["Open"])
        h = float(row["High"])
        l = float(row["Low"])
        if o <= stop:
            return o, "STOP_GAP"
        if o >= target:
            return target, "TARGET_GAP"
        stop_hit = l <= stop
        target_hit = h >= target
        if stop_hit and target_hit:
            return stop, "STOP_SAME_BAR"
        if stop_hit:
            return stop, "STOP"
        if target_hit:
            return target, "TARGET"
    if day.empty:
        return entry, "FLAT"
    last = float(day["Close"].iloc[-1])
    return last, "EOD"


def simulate_orb_trade(
    bars: pd.DataFrame,
    session: date,
    symbol: str,
    gap: float,
    params: OrbParams,
    *,
    equity: float | None = None,
) -> OrbTrade | None:
    rng = opening_range_with_params(bars, session, or_minutes=params.or_minutes)
    if rng is None or rng["status"] != "BREAKOUT":
        return None
    entry = rng["entry"]
    or_range = rng["orRange"]
    if not entry or not or_range or or_range <= 0:
        return None
    eq = equity if equity is not None else params.equity
    shares = math.floor((eq * params.risk_frac) / entry)
    if shares < 1:
        return None
    stop = entry - params.stop_r * or_range
    target = entry + params.target_r * or_range
    entry_ts = rng["breakoutAt"]
    exit_px, reason = _exit_long_intraday(bars, session, entry_ts, entry, stop, target)
    pnl = (exit_px - entry) * shares
    r_mult = (exit_px - entry) / or_range
    return OrbTrade(
        session=session,
        symbol=symbol,
        gap_pct=gap,
        entry=entry,
        exit_px=exit_px,
        shares=shares,
        or_range=or_range,
        stop=stop,
        target=target,
        exit_reason=reason,
        r_multiple=r_mult,
        pnl=pnl,
        pnl_pct_equity=pnl / eq * 100.0,
    )


def _download_daily(tickers: list[str], lookback_days: int = 75) -> dict[str, pd.DataFrame]:
    try:
        raw = yf.download(
            tickers,
            period=f"{lookback_days}d",
            interval="1d",
            auto_adjust=False,
            progress=False,
            group_by="ticker",
            threads=True,
        )
    except Exception:
        raw = pd.DataFrame()
    return _flatten_daily(raw, tickers)


@lru_cache(maxsize=256)
def _fetch_5m_panel(symbol: str) -> pd.DataFrame:
    """Full Yahoo 5m window for one symbol (~60 calendar days)."""
    df = yf.download(
        symbol,
        period="60d",
        interval="5m",
        auto_adjust=False,
        progress=False,
        threads=False,
    )
    if df is None or df.empty:
        return pd.DataFrame()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[0] for c in df.columns]
    idx = df.index
    if idx.tz is None:
        idx = idx.tz_localize("UTC")
    df = df.copy()
    df.index = idx.tz_convert(NY)
    return df


def _bars_for_session(symbol: str, session: date) -> pd.DataFrame:
    panel = _fetch_5m_panel(symbol)
    if panel.empty:
        return panel
    return panel[panel.index.date == session]


def scan_session_gappers(
    daily: dict[str, pd.DataFrame],
    session: date,
    params: OrbParams,
    tickers: Iterable[str] | None = None,
) -> list[dict]:
    symbols = list(tickers) if tickers is not None else sorted(daily.keys())
    rows: list[dict] = []
    for sym in symbols:
        df = daily.get(sym)
        if df is None or len(df) < 2:
            continue
        cols = {str(c).title(): c for c in df.columns}
        close_c = cols.get("Close") or cols.get("Adj Close")
        open_c = cols.get("Open")
        if close_c is None or open_c is None:
            continue
        sess_rows = df[pd.Series(df.index.date, index=df.index) <= session]
        if len(sess_rows) < 2:
            continue
        prev = sess_rows.iloc[-2]
        cur = sess_rows.iloc[-1]
        if pd.Timestamp(cur.name).date() != session:
            continue
        prev_close = float(prev[close_c])
        open_px = float(cur[open_c])
        g = gap_pct(prev_close, open_px)
        if g is None:
            continue
        if params.long_only:
            if g < params.gap_pct:
                continue
        elif abs(g) < params.gap_pct:
            continue
        if open_px < params.min_price:
            continue
        rows.append({"symbol": sym, "gap": g, "prev_close": prev_close, "open": open_px})
    rows.sort(key=lambda r: abs(r["gap"]), reverse=True)
    return rows[: params.max_names]


def trading_sessions_in_daily(daily: dict[str, pd.DataFrame]) -> list[date]:
    days: set[date] = set()
    for df in daily.values():
        if df is None or df.empty:
            continue
        for ts in df.index:
            days.add(pd.Timestamp(ts).date())
    return sorted(days)


def intraday_available_sessions(symbol: str = "SPY") -> list[date]:
    """Session dates with Yahoo 5m coverage (~last 60 calendar days)."""
    df = yf.download(symbol, period="60d", interval="5m", progress=False, threads=False)
    if df is None or df.empty:
        return []
    idx = df.index
    if idx.tz is None:
        idx = idx.tz_localize("UTC")
    idx = idx.tz_convert(NY)
    return sorted({ts.date() for ts in idx})


def _filter_sessions(sessions: list[date], allowed: set[date] | None) -> list[date]:
    if not allowed:
        return sessions
    return [d for d in sessions if d in allowed]


def run_orb_backtest(
    params: OrbParams | None = None,
    *,
    tickers: list[str] | None = None,
    lookback_days: int = 65,
    clear_cache: bool = False,
    daily: dict[str, pd.DataFrame] | None = None,
) -> tuple[pd.DataFrame, pd.Series, pd.DataFrame]:
    """
    Returns (trades, daily_returns, equity_curve).

    ``daily_returns`` is indexed by session date (pct change of equity).
    """
    if clear_cache:
        _fetch_5m_panel.cache_clear()
    p = params or OrbParams()
    universe = tickers or list(LIQUID)
    if daily is None:
        daily = _download_daily(universe, lookback_days=lookback_days)
    sessions = trading_sessions_in_daily(daily)
    allowed = set(intraday_available_sessions())
    sessions = _filter_sessions(sessions, allowed)
    if len(sessions) < 2:
        empty = pd.DataFrame()
        return empty, pd.Series(dtype=float), empty

    equity = p.equity
    trades: list[OrbTrade] = []
    equity_rows: list[dict] = []

    for session in sessions[1:]:
        day_start = equity
        gappers = scan_session_gappers(daily, session, p, universe)
        day_pnl = 0.0
        for g in gappers:
            sym = g["symbol"]
            bars = _bars_for_session(sym, session)
            tr = simulate_orb_trade(
                bars,
                session,
                sym,
                g["gap"],
                p,
                equity=p.equity,
            )
            if tr is None:
                continue
            trades.append(tr)
            day_pnl += tr.pnl
        equity = day_start + day_pnl
        equity_rows.append({"date": session, "equity": equity, "day_pnl": day_pnl, "n_trades": len(gappers)})

    trade_df = pd.DataFrame([t.__dict__ for t in trades])
    eq_df = pd.DataFrame(equity_rows)
    if eq_df.empty:
        return trade_df, pd.Series(dtype=float), eq_df

    eq_df["date"] = pd.to_datetime(eq_df["date"])
    eq_df = eq_df.set_index("date").sort_index()
    daily_ret = eq_df["equity"].pct_change().fillna(0.0)
    return trade_df, daily_ret, eq_df


def orb_sample_split(
    sessions: list[date],
    train_frac: float = 0.55,
) -> tuple[tuple[date, date], tuple[date, date]]:
    """Split available ORB sample (not multi-year IS/OOS)."""
    if len(sessions) < 10:
        d0, d1 = sessions[0], sessions[-1]
        return (d0, d1), (d0, d1)
    cut = max(5, int(len(sessions) * train_frac))
    is_sess = sessions[:cut]
    oos_sess = sessions[cut:]
    if not oos_sess:
        oos_sess = is_sess
    return (is_sess[0], is_sess[-1]), (oos_sess[0], oos_sess[-1])


@dataclass
class OrbGridRow:
    gap_pct: float
    or_minutes: int
    stop_r: float
    target_r: float
    n_trades: int
    win_rate: float
    avg_r: float
    total_return_pct: float
    sharpe: float
    max_drawdown_pct: float
    is_return_pct: float
    oos_return_pct: float
    is_sharpe: float
    oos_sharpe: float


def _trade_stats(trades: pd.DataFrame) -> tuple[int, float, float]:
    if trades is None or trades.empty:
        return 0, 0.0, 0.0
    n = len(trades)
    wins = (trades["pnl"] > 0).sum()
    win_rate = float(wins / n) if n else 0.0
    avg_r = float(trades["r_multiple"].mean()) if n else 0.0
    return n, win_rate, avg_r


def grid_search_orb(
    param_grid: list[OrbParams] | None = None,
    *,
    tickers: list[str] | None = None,
    lookback_days: int = 65,
) -> pd.DataFrame:
    """Rank parameter combos on OOS Sharpe within the Yahoo 5m window."""
    default_grid: list[OrbParams] = []
    for gap in (3.0, 4.0, 5.0, 6.0, 8.0):
        for or_m in (10, 15, 20, 30):
            for stop_r in (0.75, 1.0, 1.25):
                for target_r in (0.75, 1.0, 1.5, 2.0, 3.0):
                    default_grid.append(
                        OrbParams(
                            gap_pct=gap,
                            or_minutes=or_m,
                            stop_r=stop_r,
                            target_r=target_r,
                        )
                    )
    grid = param_grid or default_grid
    _fetch_5m_panel.cache_clear()
    universe = tickers or list(LIQUID)
    daily = _download_daily(universe, lookback_days=lookback_days)
    allowed = set(intraday_available_sessions())
    sessions = _filter_sessions(trading_sessions_in_daily(daily), allowed)
    (is_start, is_end), (oos_start, oos_end) = orb_sample_split(sessions)

    rows: list[OrbGridRow] = []
    for p in grid:
        trades, daily_ret, _ = run_orb_backtest(
            p,
            tickers=universe,
            lookback_days=lookback_days,
            daily=daily,
        )
        n, win_rate, avg_r = _trade_stats(trades)
        if daily_ret.empty:
            continue
        full_m = _metrics("full", sessions[1] if len(sessions) > 1 else is_start, sessions[-1], daily_ret)
        is_m = _metrics("IS", is_start, is_end, daily_ret)
        oos_m = _metrics("OOS", oos_start, oos_end, daily_ret)
        rows.append(
            OrbGridRow(
                gap_pct=p.gap_pct,
                or_minutes=p.or_minutes,
                stop_r=p.stop_r,
                target_r=p.target_r,
                n_trades=n,
                win_rate=win_rate,
                avg_r=avg_r,
                total_return_pct=full_m.total_return_pct,
                sharpe=full_m.sharpe,
                max_drawdown_pct=full_m.max_drawdown_pct,
                is_return_pct=is_m.total_return_pct,
                oos_return_pct=oos_m.total_return_pct,
                is_sharpe=is_m.sharpe,
                oos_sharpe=oos_m.sharpe,
            )
        )

    df = pd.DataFrame([r.__dict__ for r in rows])
    if df.empty:
        return df
    return df.sort_values(["oos_sharpe", "total_return_pct"], ascending=False).reset_index(drop=True)


def summarize_params(label: str, p: OrbParams, trades: pd.DataFrame, daily_ret: pd.Series, eq: pd.DataFrame) -> PeriodMetrics:
    if daily_ret.empty:
        return PeriodMetrics(label, date.today(), date.today(), 0.0, 0.0, 0.0, 0)
    start = daily_ret.index.min().date()
    end = daily_ret.index.max().date()
    return _metrics(label, start, end, daily_ret)
