"""Validation harness for the desk location playbook.

Two layers, because they use different data:

1. Daily qualification (2010s history). A name is eligible at the close when the
   production watchlist is on list (day >= +4% and relative volume >= 2×) and the
   daily close is holding a rising EMA200 ribbon within 1.5 ATR. Hot is the
   stricter subset (day >= +10% and relative volume >= 5×). Forward returns are
   measured from the next session's open. This is the scan, not the 5-minute fill.

2. Five-minute execution (Yahoo's recent 5-minute window, about 60 sessions).
   Session VWAP resets each US/Eastern date. Week AVWAP resets each Monday, matching
   ``src/lib/vwap.ts``. Longs arm on a close above the higher line, enter on a later
   retest that holds, and exit on a close back through that line or through session
   VWAP. Shorts mirror that with the lower line and week AVWAP.

The daily book is a 5-session hold of the qualification. It is not a substitute for
the 5-minute rules. Both are reported.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from pipeline.compute.param_stability import annualized_sharpe
from pipeline.compute.trend_radar import (
    HOT_MIN_DAY_PCT,
    HOT_MIN_REL_VOLUME,
    REL_VOL_BARS,
    WATCH_MIN_DAY_PCT,
    WATCH_MIN_REL_VOLUME,
    process_ticker,
    watch_rank,
)
from pipeline.ema200_scanner.config.loader import load_config
from pipeline.ema200_scanner.indicators.features import compute_features_frame
from pipeline.research.kama_backtest import max_drawdown

NY = ZoneInfo("America/New_York")

DEFAULT_TICKERS = (
    "SPY", "QQQ", "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL",
    "AVGO", "LLY", "JPM", "XOM", "CAT", "COST", "HD", "UNH", "BAC", "WMT", "AMD", "AIZ",
)
DEFAULT_START = "2021-01-01"
SIGNAL_START = "2023-01-01"
OOS_START = "2025-01-01"
HOLD_SESSIONS = 5
FORWARD_HORIZONS = (1, 5, 10, 20)
RETEST_BARS = 12
MAX_HOLD_BARS = 78 * 3
COST_BPS = 2.0  # per side
SHORTLIST_ATR = 1.5

VARIANTS = ("strict", "ribbon", "location")


@dataclass
class StudyResult:
    events: pd.DataFrame
    daily_equity: pd.DataFrame
    daily_trades: pd.DataFrame
    daily_metrics: pd.DataFrame
    intraday_trades: pd.DataFrame
    intraday_equity: pd.DataFrame
    intraday_stats: pd.DataFrame
    aiz: pd.DataFrame | None
    meta: dict = field(default_factory=dict)


def _normalize_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    if not isinstance(out.index, pd.DatetimeIndex):
        if "date" in out.columns:
            out = out.set_index("date")
        else:
            raise ValueError("OHLCV needs a DatetimeIndex or a date column")
    out.index = pd.to_datetime(out.index)
    out = out.sort_index()
    out = out[~out.index.duplicated(keep="last")]
    cols = {str(c).lower(): c for c in out.columns}
    renamed = {}
    for name in ("open", "high", "low", "close", "volume"):
        if name not in cols:
            raise ValueError(f"missing column {name}")
        renamed[cols[name]] = name
    out = out.rename(columns=renamed)
    for name in ("open", "high", "low", "close", "volume"):
        out[name] = pd.to_numeric(out[name], errors="coerce")
    return out.dropna(subset=["open", "high", "low", "close"])


def _ny_index(index: pd.DatetimeIndex) -> pd.DatetimeIndex:
    if index.tz is None:
        return index.tz_localize(NY, ambiguous="infer", nonexistent="shift_forward")
    return index.tz_convert(NY)


def add_session_week_vwap(df: pd.DataFrame) -> pd.DataFrame:
    """Session and week AVWAP. Same cumulative typical-price × volume as ``vwap.ts``.

    A zero-volume bar does not update the running total and keeps the previous
    value, including across a session boundary, matching the TypeScript loop.
    """
    out = _normalize_ohlcv(df)
    ny = _ny_index(out.index)
    session_key = pd.Index(ny.date)
    week_key = pd.Index((ny - pd.to_timedelta(ny.day_of_week, unit="D")).date)
    typical = (out["high"] + out["low"] + out["close"]) / 3.0
    volume = out["volume"].fillna(0.0).clip(lower=0.0).to_numpy(dtype=float)
    typical_np = typical.to_numpy(dtype=float)

    def _cumulative(keys: pd.Index) -> np.ndarray:
        vwap = np.full(len(out), np.nan)
        last = np.nan
        cum_pv = 0.0
        cum_v = 0.0
        prev = None
        for i, key in enumerate(keys):
            if key != prev:
                prev = key
                cum_pv = 0.0
                cum_v = 0.0
            vol = volume[i]
            price = typical_np[i]
            if vol > 0 and np.isfinite(price):
                cum_pv += price * vol
                cum_v += vol
                last = cum_pv / cum_v
            vwap[i] = last
        return vwap

    out["vwap_session"] = _cumulative(session_key)
    out["vwap_week"] = _cumulative(week_key)
    out["session"] = session_key
    return out


def daily_desk_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Causal daily columns. Row t uses only bars through t."""
    px = _normalize_ohlcv(df)
    if px.index.tz is not None:
        px = px.copy()
        px.index = px.index.tz_convert(NY).tz_localize(None).normalize()
    else:
        px = px.copy()
        px.index = pd.to_datetime(px.index).tz_localize(None).normalize()

    close = px["close"].astype(float)
    high = px["high"].astype(float)
    volume = px["volume"].astype(float)
    day_pct = (close.pct_change() * 100.0).fillna(0.0)
    prior_avg = volume.shift(1).rolling(REL_VOL_BARS, min_periods=REL_VOL_BARS).mean()
    rel_vol = (volume / prior_avg.replace(0, np.nan)).fillna(0.0)
    off_high = ((close / high.replace(0, np.nan)) - 1.0) * 100.0

    on_list = (day_pct >= WATCH_MIN_DAY_PCT) & (rel_vol >= WATCH_MIN_REL_VOLUME)
    hot = (day_pct >= HOT_MIN_DAY_PCT) & (rel_vol >= HOT_MIN_REL_VOLUME)
    ranks = [
        watch_rank(bool(listed), float(off), float(day))
        for listed, off, day in zip(on_list.to_numpy(), off_high.fillna(0.0), day_pct)
    ]

    cfg = load_config()
    feats = compute_features_frame(
        px,
        ema_period=int(cfg["ema_period"]),
        atr_period=int(cfg["atr_period"]),
        history_min_bars=int(cfg["history_min_bars"]),
        slope_lookback=int(cfg["trend"]["slope_lookback"]),
    )
    ribbon_held = (
        feats["close"].ge(feats["ema200"])
        & feats["ema200_slope"].gt(0)
        & feats["days_above"].ge(int(cfg["trend"]["min_days_above"]))
        & feats["ribbon_dist_atr"].le(SHORTLIST_ATR)
        & feats["ribbon_dist_atr"].notna()
        & feats["ema200"].notna()
    )
    below_ribbon = feats["close"].lt(feats["ema200"]) & feats["ema200"].notna()

    out = px[["open", "high", "low", "close", "volume"]].copy()
    out["day_pct"] = day_pct
    out["rel_vol"] = rel_vol
    out["off_high"] = off_high
    out["on_list"] = on_list.to_numpy()
    out["hot"] = hot.to_numpy()
    out["quality_rank"] = ranks
    out["ema200"] = feats["ema200"]
    out["ribbon_dist_atr"] = feats["ribbon_dist_atr"]
    out["ribbon_held"] = ribbon_held.fillna(False).to_numpy()
    out["below_ribbon"] = below_ribbon.fillna(False).to_numpy()
    return out


def _cost_fraction() -> float:
    return COST_BPS / 10_000.0


def build_daily_trades(
    symbol: str,
    frame: pd.DataFrame,
    signal: pd.Series,
    *,
    hold: int = HOLD_SESSIONS,
    stop_on_ribbon: bool = True,
    signal_start: str = SIGNAL_START,
) -> list[dict]:
    """Enter next open after a close signal. One position per symbol."""
    start = pd.Timestamp(signal_start)
    idx = frame.index
    trades: list[dict] = []
    busy_until = -1
    signal_arr = signal.reindex(idx).fillna(False).to_numpy(dtype=bool)
    opens = frame["open"].to_numpy(dtype=float)
    closes = frame["close"].to_numpy(dtype=float)
    emas = frame["ema200"].to_numpy(dtype=float)

    for i, flagged in enumerate(signal_arr):
        if not flagged or idx[i] < start or i <= busy_until:
            continue
        entry_i = i + 1
        if entry_i >= len(idx) or opens[entry_i] <= 0:
            continue
        exit_i = min(entry_i + hold - 1, len(idx) - 1)
        reason = "hold"
        if stop_on_ribbon:
            for j in range(entry_i, exit_i + 1):
                ema = emas[j]
                if np.isfinite(ema) and closes[j] < ema:
                    exit_i = j
                    reason = "ribbon_break"
                    break
        entry_px = float(opens[entry_i])
        exit_px = float(closes[exit_i])
        if entry_px <= 0 or exit_px <= 0:
            continue
        ret = exit_px / entry_px - 1.0 - 2.0 * _cost_fraction()
        trades.append(
            {
                "symbol": symbol,
                "signal_date": str(idx[i].date()),
                "entry_date": str(idx[entry_i].date()),
                "exit_date": str(idx[exit_i].date()),
                "entry_price": entry_px,
                "exit_price": exit_px,
                "return_pct": ret * 100.0,
                "bars_held": int(exit_i - entry_i + 1),
                "exit_reason": reason,
            }
        )
        busy_until = exit_i
    return trades


def _calendar(frames: dict[str, pd.DataFrame], start: str) -> pd.DatetimeIndex:
    stamp = pd.Timestamp(start)
    idx = pd.DatetimeIndex([])
    for frame in frames.values():
        idx = idx.union(frame.index[frame.index >= stamp])
    return idx.sort_values()


def _session_book(frames: dict[str, pd.DataFrame], trades: pd.DataFrame, calendar: pd.DatetimeIndex) -> pd.Series:
    """Equal-weight mean of concurrent trade session returns. Cash when flat."""
    buckets: dict[pd.Timestamp, list[float]] = {}
    if trades.empty or len(calendar) == 0:
        return pd.Series(0.0, index=calendar, name="return")

    for tr in trades.itertuples(index=False):
        frame = frames[tr.symbol]
        entry = pd.Timestamp(tr.entry_date)
        exit_ = pd.Timestamp(tr.exit_date)
        window = frame.loc[entry:exit_]
        if window.empty:
            continue
        prev_close = None
        dates = list(window.index)
        for k, dt in enumerate(dates):
            start_px = float(tr.entry_price) if k == 0 else float(prev_close)
            end_px = float(tr.exit_price) if k == len(dates) - 1 else float(window["close"].loc[dt])
            prev_close = float(window["close"].loc[dt])
            if start_px <= 0:
                continue
            ret = end_px / start_px - 1.0
            if k == 0:
                ret -= _cost_fraction()
            if k == len(dates) - 1:
                ret -= _cost_fraction()
            buckets.setdefault(pd.Timestamp(dt), []).append(ret)

    rets = []
    for dt in calendar:
        day = buckets.get(pd.Timestamp(dt))
        rets.append(float(np.mean(day)) if day else 0.0)
    return pd.Series(rets, index=calendar, name="return")


def _metrics_row(name: str, sample: str, rets: pd.Series, trades: pd.DataFrame) -> dict:
    r = rets.to_numpy(dtype=float) if len(rets) else np.array([])
    r = r[np.isfinite(r)]
    equity = np.cumprod(1.0 + r) if len(r) else np.array([1.0])
    subset = trades
    if sample == "is":
        subset = trades[trades["entry_date"] < OOS_START] if len(trades) else trades
    elif sample == "oos":
        subset = trades[trades["entry_date"] >= OOS_START] if len(trades) else trades
    if len(subset) == 0 or "return_pct" not in subset.columns:
        rets_t = np.array([])
    else:
        rets_t = subset["return_pct"].to_numpy(dtype=float) / 100.0
    wins = rets_t[rets_t > 0]
    losses = rets_t[rets_t <= 0]
    profit_factor = float(wins.sum() / abs(losses.sum())) if len(losses) and losses.sum() != 0 else np.nan
    return {
        "book": name,
        "sample": sample,
        "sessions": int(len(r)),
        "trades": int(len(subset)),
        "win_rate_pct": round(float((rets_t > 0).mean() * 100.0), 2) if len(rets_t) else 0.0,
        "avg_trade_pct": round(float(rets_t.mean() * 100.0), 3) if len(rets_t) else 0.0,
        "median_trade_pct": round(float(np.median(rets_t) * 100.0), 3) if len(rets_t) else 0.0,
        "profit_factor": None if not np.isfinite(profit_factor) else round(profit_factor, 2),
        "sharpe": round(annualized_sharpe(r), 3) if len(r) else 0.0,
        "total_return_pct": round(float((equity[-1] - 1.0) * 100.0), 2) if len(r) else 0.0,
        "max_drawdown_pct": round(max_drawdown(equity) * 100.0, 2) if len(r) else 0.0,
    }


def _slice_sample(rets: pd.Series, sample: str) -> pd.Series:
    if rets.empty:
        return rets
    if sample == "is":
        return rets[rets.index < OOS_START]
    if sample == "oos":
        return rets[rets.index >= OOS_START]
    return rets


def forward_event_table(frames: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Pooled next-open forward returns. Each symbol-day is one event."""
    groups = {
        "on_list": lambda f: f["on_list"],
        "hot": lambda f: f["hot"],
        "ribbon": lambda f: f["ribbon_held"],
        "on_list_and_ribbon": lambda f: f["on_list"] & f["ribbon_held"],
        "up_not_listed": lambda f: (f["day_pct"] > 0) & ~f["on_list"],
        "all_sessions": lambda f: pd.Series(True, index=f.index),
    }
    rows: list[dict] = []
    start = pd.Timestamp(SIGNAL_START)
    oos = pd.Timestamp(OOS_START)
    for name, mask_fn in groups.items():
        collected: dict[int, list[tuple[pd.Timestamp, float]]] = {h: [] for h in FORWARD_HORIZONS}
        for frame in frames.values():
            mask = mask_fn(frame).fillna(False).to_numpy(dtype=bool)
            opens = frame["open"].to_numpy(dtype=float)
            closes = frame["close"].to_numpy(dtype=float)
            for i, flagged in enumerate(mask):
                if not flagged or frame.index[i] < start:
                    continue
                entry_i = i + 1
                if entry_i >= len(frame) or opens[entry_i] <= 0:
                    continue
                entry_px = opens[entry_i]
                for h in FORWARD_HORIZONS:
                    exit_i = i + h
                    if exit_i >= len(frame):
                        continue
                    exit_px = closes[exit_i]
                    if exit_px <= 0:
                        continue
                    collected[h].append((frame.index[entry_i], exit_px / entry_px - 1.0))
        for h, pairs in collected.items():
            for sample, pred in (
                ("all", lambda dt: True),
                ("is", lambda dt: dt < oos),
                ("oos", lambda dt: dt >= oos),
            ):
                vals = np.array([v for dt, v in pairs if pred(dt)], dtype=float)
                rows.append(
                    {
                        "group": name,
                        "horizon_sessions": h,
                        "sample": sample,
                        "n": int(len(vals)),
                        "mean_pct": round(float(vals.mean() * 100.0), 3) if len(vals) else np.nan,
                        "median_pct": round(float(np.median(vals) * 100.0), 3) if len(vals) else np.nan,
                        "win_rate_pct": round(float((vals > 0).mean() * 100.0), 2) if len(vals) else np.nan,
                        "se_pct": round(float(vals.std(ddof=1) / np.sqrt(len(vals)) * 100.0), 3)
                        if len(vals) > 1
                        else np.nan,
                    }
                )
    return pd.DataFrame(rows)


def simulate_intraday(
    df: pd.DataFrame,
    allow_long: np.ndarray,
    allow_short: np.ndarray,
    *,
    symbol: str,
    variant: str,
) -> list[dict]:
    """5-minute retest execution. Fills at the next bar's open."""
    bars = add_session_week_vwap(df)
    o = bars["open"].to_numpy(dtype=float)
    h = bars["high"].to_numpy(dtype=float)
    low = bars["low"].to_numpy(dtype=float)
    c = bars["close"].to_numpy(dtype=float)
    sv = bars["vwap_session"].to_numpy(dtype=float)
    wv = bars["vwap_week"].to_numpy(dtype=float)
    n = len(bars)
    al = np.asarray(allow_long, dtype=bool)
    ash = np.asarray(allow_short, dtype=bool)
    if len(al) != n or len(ash) != n:
        raise ValueError("allow masks must match the bar count")

    trades: list[dict] = []
    state = "flat"
    side = ""
    arm_level = np.nan
    arm_i = -1
    entry_i = -1
    entry_px = np.nan
    stop = np.nan
    i = 0

    def _finish(exit_i: int, exit_px: float, reason: str) -> None:
        nonlocal state
        direction = 1.0 if side == "long" else -1.0
        gross = (exit_px / entry_px - 1.0) * direction if entry_px > 0 else 0.0
        net = gross - 2.0 * _cost_fraction()
        trades.append(
            {
                "symbol": symbol,
                "variant": variant,
                "side": side,
                "entry_time": bars.index[entry_i].isoformat(),
                "exit_time": bars.index[exit_i].isoformat(),
                "entry_price": float(entry_px),
                "exit_price": float(exit_px),
                "return_pct": float(net * 100.0),
                "bars_held": int(exit_i - entry_i),
                "exit_reason": reason,
            }
        )
        state = "flat"

    while i < n:
        reprocess = False
        if state == "flat":
            if np.isfinite(sv[i]) and np.isfinite(wv[i]):
                hi_line = max(sv[i], wv[i])
                lo_line = min(sv[i], wv[i])
                if al[i] and c[i] > hi_line:
                    state = "armed_long"
                    side = "long"
                    arm_level = hi_line
                    arm_i = i
                elif ash[i] and c[i] < lo_line:
                    state = "armed_short"
                    side = "short"
                    arm_level = lo_line
                    arm_i = i
        elif state in ("armed_long", "armed_short"):
            expired = i - arm_i > RETEST_BARS
            failed = (state == "armed_long" and c[i] <= arm_level) or (
                state == "armed_short" and c[i] >= arm_level
            )
            retest = i > arm_i and (
                (state == "armed_long" and low[i] <= arm_level and c[i] > arm_level)
                or (state == "armed_short" and h[i] >= arm_level and c[i] < arm_level)
            )
            if expired or failed or not retest:
                if expired or failed:
                    state = "flat"
                    reprocess = True
            elif i + 1 >= n or o[i + 1] <= 0:
                state = "flat"
            else:
                entry_i = i + 1
                entry_px = float(o[entry_i])
                stop = float(arm_level)
                state = "in_long" if side == "long" else "in_short"
                i = entry_i
                continue
        elif state in ("in_long", "in_short"):
            held = i - entry_i
            reason = None
            if state == "in_long" and (c[i] < stop or (np.isfinite(sv[i]) and c[i] < sv[i])):
                reason = "line" if c[i] < stop else "session_vwap"
            elif state == "in_short" and (c[i] > stop or (np.isfinite(wv[i]) and c[i] > wv[i])):
                reason = "line" if c[i] > stop else "week_avwap"
            elif held >= MAX_HOLD_BARS:
                reason = "time"
            if reason:
                if i + 1 < n and o[i + 1] > 0:
                    _finish(i + 1, float(o[i + 1]), reason)
                    i = i + 1
                    continue
                _finish(i, float(c[i]), reason + "_last")
                break
        if reprocess:
            continue
        i += 1

    if state in ("in_long", "in_short") and entry_i >= 0:
        _finish(n - 1, float(c[n - 1]), "end_of_data")
    return trades


def _prior_flags(daily: pd.DataFrame, intra_index: pd.DatetimeIndex) -> pd.DataFrame:
    """Flags known from the last completed daily session before each 5-minute bar."""
    ny = _ny_index(intra_index)
    bar_day = pd.to_datetime(pd.Series(ny.date, index=intra_index)).to_numpy(dtype="datetime64[ns]")
    daily_days = pd.to_datetime(daily.index).to_numpy(dtype="datetime64[ns]")
    pos = np.searchsorted(daily_days, bar_day, side="left") - 1
    on_list = np.zeros(len(intra_index), dtype=bool)
    ribbon = np.zeros(len(intra_index), dtype=bool)
    below = np.zeros(len(intra_index), dtype=bool)
    valid = pos >= 0
    if valid.any():
        on_list[valid] = daily["on_list"].to_numpy(dtype=bool)[pos[valid]]
        ribbon[valid] = daily["ribbon_held"].to_numpy(dtype=bool)[pos[valid]]
        below[valid] = daily["below_ribbon"].to_numpy(dtype=bool)[pos[valid]]
    return pd.DataFrame(
        {"on_list": on_list, "ribbon_held": ribbon, "below_ribbon": below},
        index=intra_index,
    )


def intraday_variant_masks(flags: pd.DataFrame, variant: str) -> tuple[np.ndarray, np.ndarray]:
    if variant == "strict":
        allow_long = (flags["on_list"] & flags["ribbon_held"]).to_numpy(dtype=bool)
        allow_short = flags["below_ribbon"].to_numpy(dtype=bool)
    elif variant == "ribbon":
        allow_long = flags["ribbon_held"].to_numpy(dtype=bool)
        allow_short = flags["below_ribbon"].to_numpy(dtype=bool)
    elif variant == "location":
        allow_long = np.ones(len(flags), dtype=bool)
        allow_short = np.ones(len(flags), dtype=bool)
    else:
        raise ValueError(variant)
    return allow_long, allow_short


def _extract_yahoo(raw: pd.DataFrame, sym: str, single: bool) -> pd.DataFrame | None:
    if raw is None or raw.empty:
        return None
    if single or not isinstance(raw.columns, pd.MultiIndex):
        frame = raw.copy()
    elif sym in raw.columns.get_level_values(0):
        frame = raw[sym].copy()
    elif sym in raw.columns.get_level_values(-1):
        frame = raw.xs(sym, axis=1, level=-1).copy()
    else:
        return None
    frame.columns = [str(c).lower() for c in frame.columns]
    if "close" not in frame.columns:
        return None
    frame = frame.dropna(subset=["close"])
    if frame.empty:
        return None
    return frame


def download_bars(tickers: list[str], start: str) -> tuple[dict[str, pd.DataFrame], dict[str, pd.DataFrame]]:
    import yfinance as yf

    cache = Path("/tmp/desk-location-cache")
    cache.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256((",".join(tickers) + "|" + start).encode()).hexdigest()[:16]
    daily_path = cache / f"daily_{key}.pkl"
    intra_path = cache / f"intra_{key}.pkl"
    if daily_path.exists() and intra_path.exists():
        return pd.read_pickle(daily_path), pd.read_pickle(intra_path)

    daily_raw = yf.download(
        tickers,
        start=start,
        auto_adjust=True,
        progress=False,
        group_by="ticker",
        threads=True,
    )
    intra_raw = yf.download(
        tickers,
        period="60d",
        interval="5m",
        auto_adjust=True,
        progress=False,
        group_by="ticker",
        threads=True,
        prepost=False,
    )
    single = len(tickers) == 1
    daily: dict[str, pd.DataFrame] = {}
    intra: dict[str, pd.DataFrame] = {}
    for sym in tickers:
        d = _extract_yahoo(daily_raw, sym, single)
        if d is not None and len(d) > REL_VOL_BARS + 5:
            daily[sym] = d
        m = _extract_yahoo(intra_raw, sym, single)
        if m is not None and len(m) > 30:
            intra[sym] = m
    pd.to_pickle(daily, daily_path)
    pd.to_pickle(intra, intra_path)
    return daily, intra


def run_study(
    tickers: list[str] | None = None,
    start: str = DEFAULT_START,
    *,
    daily: dict[str, pd.DataFrame] | None = None,
    intraday: dict[str, pd.DataFrame] | None = None,
) -> StudyResult:
    symbols = [t.strip().upper() for t in (tickers or list(DEFAULT_TICKERS)) if t.strip()]
    if daily is None or intraday is None:
        downloaded_daily, downloaded_intra = download_bars(symbols, start)
        daily = daily if daily is not None else downloaded_daily
        intraday = intraday if intraday is not None else downloaded_intra

    frames = {sym: daily_desk_frame(df) for sym, df in daily.items()}
    events = forward_event_table(frames)

    books = {
        "on_list": ("on_list", False),
        "ribbon": ("ribbon_held", True),
        "on_list_and_ribbon": ("both", True),
    }
    trade_rows: list[dict] = []
    equity_cols: dict[str, pd.Series] = {}
    calendar = _calendar(frames, SIGNAL_START)
    for book, (flag, stop) in books.items():
        book_trades: list[dict] = []
        for sym, frame in frames.items():
            if flag == "both":
                signal = frame["on_list"] & frame["ribbon_held"]
            else:
                signal = frame[flag]
            rows = build_daily_trades(sym, frame, signal, stop_on_ribbon=stop)
            for row in rows:
                row["book"] = book
            book_trades.extend(rows)
            trade_rows.extend(rows)
        tdf = pd.DataFrame(book_trades)
        equity_cols[book] = _session_book(frames, tdf, calendar)

    spy = frames.get("SPY")
    if spy is not None:
        spy_rets = spy["close"].pct_change().fillna(0.0)
        spy_rets = spy_rets[spy_rets.index >= SIGNAL_START]
        equity_cols["spy"] = spy_rets

    equity = pd.DataFrame(equity_cols).sort_index().fillna(0.0)
    equity = equity[equity.index >= SIGNAL_START]
    daily_trades = pd.DataFrame(trade_rows)

    metric_rows = []
    for book in books:
        rets = equity[book] if book in equity.columns else pd.Series(dtype=float)
        subset = daily_trades[daily_trades["book"] == book] if len(daily_trades) else daily_trades
        for sample in ("all", "is", "oos"):
            metric_rows.append(_metrics_row(book, sample, _slice_sample(rets, sample), subset))
    if "spy" in equity.columns:
        for sample in ("all", "is", "oos"):
            metric_rows.append(
                _metrics_row("spy", sample, _slice_sample(equity["spy"], sample), pd.DataFrame(columns=["entry_date", "return_pct"]))
            )
    daily_metrics = pd.DataFrame(metric_rows)

    intra_rows: list[dict] = []
    intra_prepared: dict[str, pd.DataFrame] = {}
    for sym, raw in intraday.items():
        if sym not in frames:
            continue
        bars = add_session_week_vwap(raw)
        flags = _prior_flags(frames[sym], bars.index)
        intra_prepared[sym] = bars
        for variant in VARIANTS:
            allow_long, allow_short = intraday_variant_masks(flags, variant)
            intra_rows.extend(
                simulate_intraday(bars, allow_long, allow_short, symbol=sym, variant=variant)
            )
    intraday_trades = pd.DataFrame(intra_rows)
    intra_equity, intra_stats = _intraday_summary(intraday_trades)

    aiz = intra_prepared.get("AIZ")
    meta = {
        "tickers": symbols,
        "daily_symbols": sorted(frames),
        "intraday_symbols": sorted(intra_prepared),
        "signal_start": SIGNAL_START,
        "oos_start": OOS_START,
        "hold_sessions": HOLD_SESSIONS,
        "cost_bps_per_side": COST_BPS,
        "retest_bars": RETEST_BARS,
        "rules": {
            "on_list": f"day >= {WATCH_MIN_DAY_PCT}% and rel vol >= {WATCH_MIN_REL_VOLUME}×",
            "hot": f"day >= {HOT_MIN_DAY_PCT}% and rel vol >= {HOT_MIN_REL_VOLUME}×",
            "ribbon": f"close >= rising EMA200, days above >= 20, ribbon distance <= {SHORTLIST_ATR} ATR",
            "long_5m": "close above max(session VWAP, week AVWAP), later retest holds, exit on close back through the line or session VWAP",
            "short_5m": "close below min(session VWAP, week AVWAP), later retest fails, exit on close back through the line or week AVWAP",
        },
    }
    return StudyResult(
        events=events,
        daily_equity=equity,
        daily_trades=daily_trades,
        daily_metrics=daily_metrics,
        intraday_trades=intraday_trades,
        intraday_equity=intra_equity,
        intraday_stats=intra_stats,
        aiz=aiz,
        meta=meta,
    )


def _trade_stat_row(variant: str, side: str, sub: pd.DataFrame) -> dict:
    rets = sub["return_pct"].to_numpy(dtype=float) / 100.0 if len(sub) else np.array([])
    wins = rets[rets > 0]
    losses = rets[rets <= 0]
    return {
        "variant": variant,
        "side": side,
        "trades": int(len(sub)),
        "win_rate_pct": round(float((rets > 0).mean() * 100.0), 2) if len(rets) else 0.0,
        "avg_trade_pct": round(float(rets.mean() * 100.0), 3) if len(rets) else 0.0,
        "median_trade_pct": round(float(np.median(rets) * 100.0), 3) if len(rets) else 0.0,
        "profit_factor": round(float(wins.sum() / abs(losses.sum())), 2) if len(losses) and losses.sum() != 0 else None,
    }


def _intraday_summary(trades: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Session book: each day's return is the equal-weight mean of trades that closed that day."""
    stats_rows = []
    equity = pd.DataFrame()
    if trades.empty:
        return equity, pd.DataFrame(stats_rows)
    curves = {}
    stamped = trades.copy()
    stamped["exit_ts"] = pd.to_datetime(stamped["exit_time"], utc=True).dt.tz_convert(NY)
    stamped["session"] = stamped["exit_ts"].dt.normalize()
    for variant in VARIANTS:
        sub = stamped[stamped["variant"] == variant]
        stats_rows.append(_trade_stat_row(variant, "all", sub))
        for side in ("long", "short"):
            stats_rows.append(_trade_stat_row(variant, side, sub[sub["side"] == side]))
        if sub.empty:
            continue
        daily = sub.groupby("session")["return_pct"].mean() / 100.0
        idx = pd.date_range(daily.index.min(), daily.index.max(), freq="B", tz=NY)
        daily = daily.reindex(idx, fill_value=0.0)
        curves[variant] = (1.0 + daily).cumprod()
        stats_rows[-3]["session_book_pct"] = round(float((curves[variant].iloc[-1] - 1.0) * 100.0), 2)
    if curves:
        equity = pd.DataFrame(curves)
    return equity, pd.DataFrame(stats_rows)


def narrate(result: StudyResult) -> str:
    """Short factual reading of the tables. Numbers come from this run."""
    ev = result.events
    focus = ev[(ev["sample"] == "all") & (ev["horizon_sessions"] == 5)]
    lines = ["Five-session forward returns from the next open (all symbols pooled, 2 bps per side is not in this event table):"]
    for _, row in focus.iterrows():
        if row["n"] == 0 or not np.isfinite(row["mean_pct"]):
            lines.append(f"- {row['group']}: no events")
        else:
            lines.append(
                f"- {row['group']}: n={int(row['n'])}, mean {row['mean_pct']:+.3f}%, "
                f"median {row['median_pct']:+.3f}%, win rate {row['win_rate_pct']:.1f}%"
            )
    m = result.daily_metrics
    lines.append("Daily books versus SPY (compounded session returns, 2 bps per side):")
    for _, row in m.iterrows():
        lines.append(
            f"- {row['book']} {row['sample']}: trades {int(row['trades'])}, "
            f"avg trade {row['avg_trade_pct']:+.3f}%, Sharpe {row['sharpe']}, "
            f"total {row['total_return_pct']:+.2f}%, max DD {row['max_drawdown_pct']:.2f}%"
        )
    lines.append("Five-minute execution on the recent Yahoo window (2 bps per side):")
    if result.intraday_stats.empty:
        lines.append("- no 5-minute trades")
    else:
        for _, row in result.intraday_stats.iterrows():
            book = row["session_book_pct"] if "session_book_pct" in row and pd.notna(row["session_book_pct"]) else None
            book_s = f", session book {book:+.2f}%" if book is not None else ""
            lines.append(
                f"- {row['variant']} {row['side']}: trades {int(row['trades'])}, "
                f"win rate {row['win_rate_pct']}%, avg {row['avg_trade_pct']:+.3f}%, "
                f"median {row['median_trade_pct']:+.3f}%{book_s}"
            )
    both = result.events[
        (result.events["group"] == "on_list_and_ribbon")
        & (result.events["sample"] == "all")
        & (result.events["horizon_sessions"] == 5)
    ]
    n_both = int(both["n"].iloc[0]) if len(both) else 0
    lines.append(
        f"On-list and ribbon together: {n_both} events in the daily sample. "
        "A +4% day usually leaves the close more than 1.5 ATR from the EMA200 ribbon, so the two filters almost never fire on the same close."
    )
    return "\n".join(lines)


def make_figures(result: StudyResult, out_dir: Path) -> list[Path]:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    out_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    colors = {
        "on_list": "#b45309",
        "hot": "#b91c1c",
        "ribbon": "#1d4ed8",
        "on_list_and_ribbon": "#0f766e",
        "up_not_listed": "#64748b",
        "all_sessions": "#94a3b8",
        "spy": "#334155",
        "strict": "#0f766e",
        "location": "#b45309",
    }

    fig, ax = plt.subplots(figsize=(10.5, 5.2))
    sub = result.events[(result.events["sample"] == "all") & (result.events["horizon_sessions"] == 5)]
    order = ["all_sessions", "up_not_listed", "ribbon", "on_list", "hot"]
    sub = sub.set_index("group").reindex(order).dropna(subset=["n"])
    rare = result.events[
        (result.events["sample"] == "all")
        & (result.events["horizon_sessions"] == 5)
        & (result.events["group"] == "on_list_and_ribbon")
    ]
    x = np.arange(len(sub))
    means = sub["mean_pct"].to_numpy(dtype=float)
    ses = sub["se_pct"].fillna(0).to_numpy(dtype=float)
    ax.bar(x, means, color=[colors.get(g, "#334155") for g in sub.index], yerr=ses, capsize=3, ecolor="#334155")
    ax.axhline(0, color="#0f172a", lw=0.8)
    ax.set_xticks(x)
    ax.set_xticklabels(
        [f"{g.replace('_', ' ')}\nn={int(n)}" for g, n in zip(sub.index, sub["n"])],
        fontsize=8,
    )
    ax.set_ylabel("Mean return, next open to close +5 sessions (%)")
    rare_note = ""
    if len(rare) and int(rare["n"].iloc[0]) > 0:
        rare_note = f" — on list and ribbon n={int(rare['n'].iloc[0])} at {float(rare['mean_pct'].iloc[0]):+.1f}% (omitted, one event)"
    ax.set_title("Daily qualification — 5-session forward return" + rare_note, fontsize=11)
    fig.tight_layout()
    p = out_dir / "forward_5d.png"
    fig.savefig(p, dpi=140)
    plt.close(fig)
    paths.append(p)

    fig, ax = plt.subplots(figsize=(10.5, 5.2))
    groups = ["all_sessions", "on_list", "ribbon"]
    width = 0.36
    ev = result.events[result.events["horizon_sessions"] == 5]
    for offset, sample in ((-width / 2, "is"), (width / 2, "oos")):
        rows = ev[ev["sample"] == sample].set_index("group").reindex(groups)
        ax.bar(
            np.arange(len(groups)) + offset,
            rows["mean_pct"].to_numpy(dtype=float),
            width=width,
            label=sample.upper(),
            color="#0f766e" if sample == "oos" else "#94a3b8",
        )
    ax.axhline(0, color="#0f172a", lw=0.8)
    ax.set_xticks(np.arange(len(groups)))
    ax.set_xticklabels([g.replace("_", " ") for g in groups], fontsize=8)
    ax.set_ylabel("Mean 5-session return (%)")
    ax.set_title("In-sample through 2024 vs out-of-sample from 2025")
    ax.legend(frameon=False)
    fig.tight_layout()
    p = out_dir / "forward_5d_is_oos.png"
    fig.savefig(p, dpi=140)
    plt.close(fig)
    paths.append(p)

    fig, ax = plt.subplots(figsize=(10.5, 5.2))
    eq = result.daily_equity
    if not eq.empty:
        growth = (1.0 + eq.fillna(0.0)).cumprod()
        for col in growth.columns:
            ax.plot(growth.index, growth[col], label=col.replace("_", " "), color=colors.get(col, None), lw=1.6)
        oos = pd.Timestamp(OOS_START)
        if growth.index.min() < oos < growth.index.max():
            ax.axvline(oos, color="#94a3b8", ls="--", lw=1, label="OOS start")
        ax.legend(frameon=False, fontsize=8)
    ax.set_title("Daily books, compounded (cash when no position)")
    ax.set_ylabel("Growth of $1")
    fig.tight_layout()
    p = out_dir / "daily_equity.png"
    fig.savefig(p, dpi=140)
    plt.close(fig)
    paths.append(p)

    fig, ax = plt.subplots(figsize=(10.5, 5.2))
    conj = result.daily_trades[result.daily_trades["book"] == "on_list_and_ribbon"] if len(result.daily_trades) else pd.DataFrame()
    listed = result.daily_trades[result.daily_trades["book"] == "on_list"] if len(result.daily_trades) else pd.DataFrame()
    if len(listed):
        ax.hist(listed["return_pct"], bins=30, alpha=0.45, color=colors["on_list"], label="on list")
    if len(conj):
        ax.hist(conj["return_pct"], bins=20, alpha=0.75, color=colors["on_list_and_ribbon"], label="on list and ribbon")
    ax.axvline(0, color="#0f172a", lw=0.8)
    ax.set_xlabel("Trade return (%)")
    ax.set_ylabel("Trades")
    ax.set_title("Daily hold returns")
    ax.legend(frameon=False)
    fig.tight_layout()
    p = out_dir / "daily_trade_distribution.png"
    fig.savefig(p, dpi=140)
    plt.close(fig)
    paths.append(p)

    fig, ax = plt.subplots(figsize=(10.5, 5.2))
    ie = result.intraday_equity
    if not ie.empty:
        for col in ie.columns:
            series = ie[col].dropna()
            if series.empty:
                continue
            ax.step(range(len(series)), series.to_numpy(), where="post", label=col, color=colors.get(col, None), lw=1.6)
        ax.legend(frameon=False, fontsize=8)
    ax.axhline(1, color="#94a3b8", lw=0.8)
    ax.set_ylabel("Growth of $1")
    ax.set_title("5-minute book — day's return is the mean of trades closed that session")
    fig.tight_layout()
    p = out_dir / "intraday_equity.png"
    fig.savefig(p, dpi=140)
    plt.close(fig)
    paths.append(p)

    if result.aiz is not None and not result.aiz.empty:
        fig, ax = plt.subplots(figsize=(10.5, 5.2))
        bars = result.aiz
        ny = _ny_index(bars.index)
        last_sessions = pd.Index(ny.date).unique()[-5:]
        mask = pd.Index(ny.date).isin(last_sessions)
        view = bars.loc[mask]
        ax.plot(range(len(view)), view["close"], color="#0f172a", lw=1.0, label="close")
        ax.plot(range(len(view)), view["vwap_session"], color="#ea580c", lw=1.2, label="session VWAP")
        ax.plot(range(len(view)), view["vwap_week"], color="#7c3aed", lw=1.0, ls="--", label="week AVWAP")
        ax.set_title("AIZ — last five sessions, 5-minute")
        ax.set_ylabel("Price")
        ax.legend(frameon=False, fontsize=8)
        fig.tight_layout()
        p = out_dir / "aiz_vwap.png"
        fig.savefig(p, dpi=140)
        plt.close(fig)
        paths.append(p)

    return paths


def save_tables(result: StudyResult, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    result.events.to_csv(out_dir / "forward_returns.csv", index=False)
    result.daily_metrics.to_csv(out_dir / "daily_metrics.csv", index=False)
    result.daily_trades.to_csv(out_dir / "daily_trades.csv", index=False)
    result.intraday_stats.to_csv(out_dir / "intraday_stats.csv", index=False)
    if len(result.intraday_trades):
        result.intraday_trades.to_csv(out_dir / "intraday_trades.csv", index=False)
    (out_dir / "summary.json").write_text(
        json.dumps(
            {
                "meta": result.meta,
                "narration": narrate(result),
                "daily_metrics": result.daily_metrics.to_dict(orient="records"),
                "intraday_stats": result.intraday_stats.to_dict(orient="records"),
            },
            indent=2,
            default=str,
        )
    )


def production_row_matches_process_ticker(df: pd.DataFrame) -> bool:
    """Last bar of the vectorized frame equals ``process_ticker`` (no lookahead drift)."""
    frame = daily_desk_frame(df)
    raw = _normalize_ohlcv(df)
    payload = raw.reset_index()
    if "date" not in payload.columns:
        payload = payload.rename(columns={payload.columns[0]: "date"})
    got = process_ticker(payload[["date", "open", "high", "low", "close", "volume"]])
    if got is None:
        return False
    last = frame.iloc[-1]
    timing = "hot" if bool(last["hot"]) else "watch" if bool(last["on_list"]) else "off"
    state = 1 if bool(last["on_list"]) else -1 if float(last["day_pct"]) < 0 else 0
    return (
        abs(float(last["day_pct"]) - float(got["z_mom"])) < 1e-6
        and abs(float(last["rel_vol"]) - float(got["f_ewmac"])) < 1e-6
        and int(last["quality_rank"]) == int(got["quality_rank"])
        and state == int(got["state"])
        and timing == got["entry_timing"]
    )


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Desk location strategy validation")
    parser.add_argument("--tickers", default=",".join(DEFAULT_TICKERS))
    parser.add_argument("--start", default=DEFAULT_START)
    parser.add_argument("--out", default="pipeline/research/artifacts/desk_location")
    args = parser.parse_args()
    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    result = run_study(tickers, args.start)
    out = Path(args.out)
    save_tables(result, out)
    figures = make_figures(result, out)
    print(narrate(result))
    for fig in figures:
        print(fig)


if __name__ == "__main__":
    main()
