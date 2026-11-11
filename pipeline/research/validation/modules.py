"""Offline validation runs for each trading-strategy module.

Each runner calls the production rule on the shared synthetic tape and
marks the book from the next session. Costs are the paper default: 10 bps
a side. The tape is synthetic. The charts check the rules, not live edge.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline.compute.donchian_vwap import TOP_N
from pipeline.compute.kama_regime import (
    KAMA_LONG_FAST,
    KAMA_LONG_N,
    KAMA_LONG_SLOW,
    calculate_kama,
)
from pipeline.compute.perps_math import CARVER_CAP, blended_carver_forecast
from pipeline.compute.relative_strength import (
    percentile_ranks,
    sector_residual_returns,
    window_return,
)
from pipeline.research.ema200_backtest import simulate_long_touch
from pipeline.research.rotate_backtest import canary_overlay_returns, synthetic_books
from pipeline.research.tema_backtest import strategy_returns
from pipeline.research.validation.metrics import (
    ROUND_TRIP_PCT,
    ModuleRun,
    align_benchmark,
    equity_curve,
    spell_returns,
    summarize,
)
from pipeline.research.validation.panel import (
    as_of_dates,
    close_matrix,
    equal_weight_returns,
    sectors,
    symbols,
    synthetic_panel,
)
from pipeline.research.watchlist_backtest import simulate_watchlist_trades
from pipeline.strategies.donchian_vwap import signals as donchian_signals
from pipeline.triangle_scanner.patterns.triangles import detect_triangle

NOTE = "Synthetic tape, seeded. Paper costs of 10 bps a side. Not a live-edge claim."


def _finish(
    module_id: str,
    title: str,
    rules: list[str],
    daily: pd.Series,
    bench: pd.Series,
    trades_pct: np.ndarray,
    note: str = NOTE,
) -> ModuleRun:
    strat, market = align_benchmark(daily, bench)
    return ModuleRun(
        module_id=module_id,
        title=title,
        rules=rules,
        equity=equity_curve(strat),
        benchmark=equity_curve(market),
        trade_returns_pct=np.asarray(trades_pct, dtype=float),
        metrics=summarize(strat, trades_pct),
        note=note,
    )


def _indexed(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["date"] = pd.to_datetime(out["date"])
    return out.set_index("date").sort_index()


def run_watchlist(panel: dict[str, pd.DataFrame] | None = None) -> ModuleRun:
    """Module 1 — +4% and 2× volume, one session, next open to that close."""
    panel = panel or synthetic_panel()
    bench = equal_weight_returns(panel)
    by_day: dict[pd.Timestamp, list[float]] = {}
    trades: list[float] = []
    for sym, df in panel.items():
        indexed = _indexed(df)
        for trade in simulate_watchlist_trades(sym, indexed):
            net = trade.return_pct - ROUND_TRIP_PCT
            trades.append(net)
            day = pd.Timestamp(trade.exit_date)
            by_day.setdefault(day, []).append(net / 100.0)
    daily = bench * 0.0
    for day, rets in by_day.items():
        if day in daily.index:
            daily.loc[day] = float(np.mean(rets))
    return _finish(
        "module-1-watchlist",
        "Module 1 — momentum watchlist",
        [
            "On list when the day is at least +4% and volume is at least 2× the prior 50-day average.",
            "Hot when the day is at least +10% and volume is at least 5×.",
            "Enter the next session open after an off-to-on flip. Exit that session's close.",
            "Subtract 5 bps commission and 5 bps slippage on the entry and again on the exit.",
        ],
        daily,
        bench,
        np.array(trades),
    )


def run_donchian(panel: dict[str, pd.DataFrame] | None = None) -> ModuleRun:
    """Module 4 — Donchian 55 break and 20-day VWAP, top 8, 5-session hold."""
    panel = panel or synthetic_panel()
    closes = close_matrix(panel)
    bench = equal_weight_returns(panel)
    dates = as_of_dates(panel)
    holdings: dict[str, float] = {}
    daily = pd.Series(0.0, index=closes.index)
    trades: list[float] = []
    prev: set[str] = set()
    for i, d in enumerate(dates[:-1]):
        entered: set[str] = set()
        exited: set[str] = set()
        if i % 5 == 0 and i >= 60:
            sigs = donchian_signals(symbols(), panel, d)
            buys = [s.symbol for s in sigs if s.side == "BUY"][:TOP_N]
            holdings = {sym: 1.0 / len(buys) for sym in buys} if buys else {}
            entered = set(holdings) - prev
            exited = prev - set(holdings)
            for sym in entered | exited:
                trades.append(-ROUND_TRIP_PCT / 2.0)
            prev = set(holdings)
        if not holdings:
            continue
        day = closes.index[i + 1]
        ret = 0.0
        for sym, w in holdings.items():
            prev_px = float(closes[sym].iloc[i])
            px = float(closes[sym].iloc[i + 1])
            if prev_px > 0:
                ret += w * (px / prev_px - 1.0)
        turn = (len(entered) + len(exited)) / 2.0 if i % 5 == 0 else 0.0
        ret -= turn * (ROUND_TRIP_PCT / 100.0) / max(len(holdings), 1)
        daily.loc[day] = ret
        if entered or exited:
            trades.append(ret * 100.0)
    return _finish(
        "module-4-donchian",
        "Module 4 — Donchian 55 + VWAP",
        [
            "Eligible when the prior close is above the prior 55-day high and above the 20-day VWAP.",
            "Exit when the close is under the prior 20-day low.",
            "Hold the top 8 by breakout strength, equal weight, rebalance every 5 sessions.",
            "The decision uses the prior bar. The book earns the next close-to-close return.",
        ],
        daily,
        bench,
        np.array(trades) if trades else np.array([]),
    )


def run_xs(panel: dict[str, pd.DataFrame] | None = None) -> ModuleRun:
    """XS sleeve — 63-session sector residual, top names, 5-session rebalance."""
    panel = panel or synthetic_panel()
    closes = close_matrix(panel)
    bench = equal_weight_returns(panel)
    sec = sectors()
    daily = pd.Series(0.0, index=closes.index)
    trades: list[float] = []
    hold_leg = 0.0
    holdings: dict[str, float] = {}
    for i in range(70, len(closes) - 1):
        if (i - 70) % 5 == 0:
            if hold_leg != 0.0 or trades:
                if (i - 70) > 0:
                    trades.append(hold_leg * 100.0)
            hold_leg = 0.0
            raw: dict[str, float] = {}
            for sym in closes.columns:
                r = window_return(closes[sym].iloc[: i + 1], lookback=63)
                if r is not None:
                    raw[sym] = r
            resid = sector_residual_returns(raw, sec)
            ranks = percentile_ranks(resid)
            ranked = sorted(ranks, key=lambda s: (-ranks[s], s))
            picked: list[str] = []
            per_sec: dict[str, int] = {}
            for sym in ranked:
                s = sec[sym]
                if per_sec.get(s, 0) >= 2:
                    continue
                picked.append(sym)
                per_sec[s] = per_sec.get(s, 0) + 1
                if len(picked) == 8:
                    break
            holdings = {sym: 1.0 / len(picked) for sym in picked} if picked else {}
        if not holdings:
            continue
        ret = 0.0
        for sym, w in holdings.items():
            a = float(closes[sym].iloc[i])
            b = float(closes[sym].iloc[i + 1])
            if a > 0:
                ret += w * (b / a - 1.0)
        if (i - 70) % 5 == 0:
            ret -= ROUND_TRIP_PCT / 100.0
        hold_leg += ret
        daily.iloc[i + 1] = ret
    if hold_leg != 0.0:
        trades.append(hold_leg * 100.0)
    return _finish(
        "xs-relative-strength",
        "XS sleeve — sector residual strength",
        [
            "Score is the 63-session return minus the equal-weight return of the same sector.",
            "A one-name sector is dropped. There is no peer to be relative to.",
            "Hold the top 8, at most 2 per sector, and rebalance every 5 sessions.",
            "A down close is not an exit. The sleeve leaves a name when it falls out of the basket.",
        ],
        daily,
        bench,
        np.array([t for t in trades]),
    )


def run_opening_range(panel: dict[str, pd.DataFrame] | None = None) -> ModuleRun:
    """Module 7 — 4% gap, then the production 15-minute opening-range break."""
    panel = panel or synthetic_panel()
    bench = equal_weight_returns(panel)
    return _opening_range_averaged(panel, bench)


def _five_minute_session(row: pd.Series, session: date) -> pd.DataFrame:
    """Map one daily bar onto a New York 5-minute session so the OR rule can run.

    The opening range is a tight band around the open. Later bars walk toward
    the daily close and do not reuse the full-day low, which often printed
    before the breakout.
    """
    start = pd.Timestamp(session).tz_localize("America/New_York") + pd.Timedelta(hours=9, minutes=30)
    times = [start + pd.Timedelta(minutes=5 * k) for k in range(12)]
    op = float(row["open"])
    cl = float(row["close"])
    or_low = op * 0.996
    or_high = op * 1.004
    opens, highs, lows, closes = [], [], [], []
    for k in range(12):
        if k < 3:
            o = op if k == 0 else closes[-1]
            c = or_low + (or_high - or_low) * (0.35 + 0.25 * k)
            h = min(max(o, c, or_high if k == 2 else max(o, c)), or_high)
            l = max(min(o, c), or_low)
        else:
            o = closes[-1]
            c = o + (cl - o) * 0.4
            h = max(o, c)
            l = min(o, c)
        opens.append(o)
        highs.append(h)
        lows.append(l)
        closes.append(c)
    idx = pd.DatetimeIndex(times)
    return pd.DataFrame({"Open": opens, "High": highs, "Low": lows, "Close": closes}, index=idx)


def _bracket_return(bars: pd.DataFrame, event: dict) -> float | None:
    from pipeline.compute.opening_range import or_bracket

    entry = float(event["entry"])
    width = float(event["orRange"] or 0)
    if entry <= 0 or width <= 0:
        return None
    stop, target = or_bracket(entry, width)
    ts = pd.Timestamp(event["breakoutAt"])
    after = bars[bars.index > ts]
    for _, bar in after.iterrows():
        if float(bar["Low"]) <= stop:
            return (stop / entry - 1.0) * 100.0
        if float(bar["High"]) >= target:
            return (target / entry - 1.0) * 100.0
    last = float(bars["Close"].iloc[-1])
    return (last / entry - 1.0) * 100.0


def _opening_range_averaged(panel: dict[str, pd.DataFrame], bench: pd.Series) -> ModuleRun:
    from pipeline.compute.opening_range import gap_pct, opening_range

    bucket: dict[pd.Timestamp, list[float]] = {}
    trades: list[float] = []
    for _sym, df in panel.items():
        frame = df.reset_index(drop=True)
        for i in range(1, len(frame)):
            gap = gap_pct(float(frame.loc[i - 1, "close"]), float(frame.loc[i, "open"]))
            if gap is None or gap < 4.0:
                continue
            session = pd.Timestamp(frame.loc[i, "date"]).date()
            bars = _five_minute_session(frame.loc[i], session)
            event = opening_range(bars, session)
            if not event or event.get("status") != "BREAKOUT" or not event.get("entry"):
                continue
            gross = _bracket_return(bars, event)
            if gross is None:
                continue
            net = gross - ROUND_TRIP_PCT
            trades.append(net)
            bucket.setdefault(pd.Timestamp(frame.loc[i, "date"]), []).append(net / 100.0)
    daily = bench * 0.0
    for day, rets in bucket.items():
        if day in daily.index:
            daily.loc[day] = float(np.mean(rets))
    return _finish(
        "module-7-opening-range",
        "Module 7 — opening range breakout",
        [
            "Screen a gap of at least 4% versus the prior close.",
            "Opening range is 09:30–09:45 New York. A long triggers on the first later 5-minute close above that high.",
            "Stop is entry minus the range. Target is entry plus the range.",
            "This notebook rebuilds a 5-minute session from the daily bar, then calls the production range function.",
        ],
        daily,
        bench,
        np.array(trades),
        note=NOTE + " Intraday path is reconstructed from the daily bar.",
    )


def run_tema(panel: dict[str, pd.DataFrame] | None = None) -> ModuleRun:
    """Module 11 TEMA — close above TEMA-199 and TEMA-9 above TEMA-99, else flat."""
    panel = panel or synthetic_panel()
    closes = close_matrix(panel)
    bench = equal_weight_returns(panel)
    stacked = []
    trades: list[float] = []
    for sym in closes.columns:
        px = closes[sym].to_numpy(dtype=float)
        strat, pos = strategy_returns(px)
        series = pd.Series(strat, index=closes.index[1:])
        stacked.append(series)
        bar = np.diff(px) / np.where(px[:-1] == 0, np.nan, px[:-1])
        trades.extend(spell_returns(pos[:-1], bar).tolist())
    daily = pd.concat(stacked, axis=1).mean(axis=1).reindex(closes.index).fillna(0.0)
    return _finish(
        "module-11-tema",
        "Module 11 — TEMA 9 / 99 / 199",
        [
            "Long when close is above TEMA-199 and TEMA-9 is above TEMA-99.",
            "Short when both point down. Otherwise flat.",
            "MACD close flattens the position.",
            "The position from today's close earns the next close-to-close return.",
        ],
        daily,
        bench,
        np.array(trades),
    )


def run_carver(panel: dict[str, pd.DataFrame] | None = None) -> ModuleRun:
    """Module 11 Carver — blended EWMAC forecast, scaled by the forecast cap."""
    panel = panel or synthetic_panel()
    closes = close_matrix(panel)
    bench = equal_weight_returns(panel)
    daily = pd.Series(0.0, index=closes.index)
    trades: list[float] = []
    for sym in closes.columns:
        px = closes[sym].to_numpy(dtype=float)
        pos = np.zeros(len(px))
        for i in range(120, len(px) - 1):
            forecast, _, _ = blended_carver_forecast(px[: i + 1])
            pos[i] = forecast / CARVER_CAP
        rets = pd.Series(px, index=closes.index).pct_change().fillna(0.0)
        # Forecast at i uses closes through i, so it earns i → i+1.
        earned = pd.Series(pos, index=closes.index).shift(1).fillna(0.0) * rets
        daily = daily.add(earned, fill_value=0.0)
        trades.extend(spell_returns(pos, rets.to_numpy()).tolist())
    daily = daily / len(closes.columns)
    return _finish(
        "module-11-carver",
        "Module 11 — Carver EWMAC cash",
        [
            "Forecast is the average of the fast and slow EWMAC, clipped at ±20.",
            "Position is forecast / 20, so a full forecast is a full unit.",
            "The forecast uses closes through today and earns the next session.",
            "Names are equal-weighted in the sleeve.",
        ],
        daily,
        bench,
        np.array(trades),
    )


def run_rotation(panel: dict[str, pd.DataFrame] | None = None) -> ModuleRun:
    """Module 12 — canary overlay: tech when the canary is risk-on, staples otherwise."""
    del panel  # The production canary test builds its own sector books.
    overlay, univ = canary_overlay_returns(synthetic_books(320))
    idx = pd.bdate_range(end="2026-10-30", periods=len(overlay))
    daily = pd.Series(overlay, index=idx)
    bench = pd.Series(univ, index=idx)
    trades = np.asarray(overlay, dtype=float) * 100.0
    return _finish(
        "module-12-rotation",
        "Module 12 — beta rotation canary",
        [
            "Canary score uses the sector books (tech versus the broad book, and the defensive pair).",
            "When the score is positive, hold the tech book. Otherwise hold staples.",
            "The choice is refreshed every 5 sessions.",
            "Compared with staying in the broad book the whole time.",
        ],
        daily,
        bench,
        trades,
        note=NOTE + " Sector books are the research canary paths, not the equity panel.",
    )


def run_triangle(panel: dict[str, pd.DataFrame] | None = None) -> ModuleRun:
    """Module 14 — ascending or descending breakout, then 10 sessions."""
    panel = panel or synthetic_panel()
    closes = close_matrix(panel)
    bench = equal_weight_returns(panel)
    daily = pd.Series(0.0, index=closes.index)
    trades: list[float] = []
    for sym, df in panel.items():
        held_until = -1
        for i in range(80, len(df) - 11):
            if i < held_until:
                continue
            window = df.iloc[: i + 1]
            hit = detect_triangle(window, "ascending") or detect_triangle(window, "descending")
            if not hit or hit.get("status") not in ("breakout_up", "breakout_down"):
                continue
            entry = float(closes[sym].iloc[i])
            exit_ = float(closes[sym].iloc[i + 10])
            if entry <= 0:
                continue
            sign = 1.0 if hit["status"] == "breakout_up" else -1.0
            gross = sign * (exit_ / entry - 1.0) * 100.0
            net = gross - ROUND_TRIP_PCT
            trades.append(net)
            daily.iloc[i + 10] = daily.iloc[i + 10] + net / 100.0
            held_until = i + 10
    # Mean across names is not known per day; the additions are sparse so leave the sum,
    # which is the book P&L of one unit per breakout.
    return _finish(
        "module-14-triangle",
        "Module 14 — triangle breakout",
        [
            "Ascending: flat swing highs and rising swing lows. Descending: flat lows and falling highs.",
            "Breakout up when the close clears the resistance line by the buffer.",
            "Hold 10 sessions. A downside break is a short for the same window.",
            "Detection uses only bars up to the signal day.",
        ],
        daily,
        bench,
        np.array(trades),
    )


def run_ema200(panel: dict[str, pd.DataFrame] | None = None) -> ModuleRun:
    """EMA200 touch — long the bounce, stop at 1.5 ATR, else time or a close back under the EMA."""
    from pipeline.ema200_scanner.signals.ema200_touch import TouchParams, detect_events

    panel = panel or synthetic_panel()
    bench = equal_weight_returns(panel)
    params = TouchParams(history_min_bars=220, min_days_above=15)
    daily = equal_weight_returns(panel) * 0.0
    trades: list[float] = []
    for sym, df in panel.items():
        ohlcv = _indexed(df)[["open", "high", "low", "close", "volume"]]
        events = detect_events(ohlcv, params)
        book, earned = simulate_long_touch(ohlcv, events)
        daily = daily.add(pd.Series(earned, index=ohlcv.index[1:]), fill_value=0.0)
        for trade in book:
            trades.append(float(trade.return_pct) * 100.0 - ROUND_TRIP_PCT)
    if len(panel):
        daily = daily / len(panel)
    trade_arr = np.array([t - ROUND_TRIP_PCT for t in trades], dtype=float)
    return _finish(
        "ema200-touch",
        "EMA200 touch bounce",
        [
            "Long when price has stayed above a rising EMA200 and the low tags the EMA within 0.25 ATR.",
            "The close must hold the EMA. A close under it is a breakdown, not a buy.",
            "Exit on an ATR stop, a close back under the EMA, or the research time stop.",
            "History floor in this notebook is 220 bars so the synthetic tape can show the rule. Production warmup is longer.",
        ],
        daily,
        bench,
        trade_arr,
    )


def run_kama(panel: dict[str, pd.DataFrame] | None = None) -> ModuleRun:
    """Production regime — long only while the prior close is above the long KAMA."""
    panel = panel or synthetic_panel()
    closes = close_matrix(panel)
    bench = equal_weight_returns(panel)
    daily = pd.Series(0.0, index=closes.index)
    trades: list[float] = []
    for sym in closes.columns:
        close = closes[sym]
        kl = calculate_kama(close, n=KAMA_LONG_N, fast=KAMA_LONG_FAST, slow=KAMA_LONG_SLOW)
        pos = (close.shift(1) > kl.shift(1)).astype(float).fillna(0.0)
        rets = close.pct_change().fillna(0.0)
        held = pos.shift(1).fillna(0.0)
        daily = daily.add(held * rets, fill_value=0.0)
        trades.extend(spell_returns(held.to_numpy(), rets.to_numpy()).tolist())
    daily = daily / len(closes.columns)
    return _finish(
        "kama-regime",
        "KAMA regime gate",
        [
            "Production regime is bullish when the prior close is above the long KAMA.",
            "The research cross of short KAMA over long KAMA is not the production gate.",
            "This book is long-only in a bullish regime and flat otherwise.",
            "The regime known yesterday earns today's close-to-close return.",
        ],
        daily,
        bench,
        np.array(trades),
    )


def run_daily_bias(panel: dict[str, pd.DataFrame] | None = None) -> ModuleRun:
    """Module 10 — next-session return signed by the bias card (long / short / flat)."""
    from pipeline.compute.daily_bias import build_card

    panel = panel or synthetic_panel()
    closes = close_matrix(panel)
    bench = equal_weight_returns(panel)
    daily = pd.Series(0.0, index=closes.index)
    trades: list[float] = []
    for sym, df in panel.items():
        high = df["high"].to_numpy(dtype=float)
        low = df["low"].to_numpy(dtype=float)
        close = df["close"].to_numpy(dtype=float)
        for i in range(60, len(df) - 1):
            card = build_card(close[: i + 1], high[: i + 1], low[: i + 1])
            if not card:
                continue
            bias = card["bias"]
            if bias == "LONG":
                sign = 1.0
            elif bias == "SHORT":
                sign = -1.0
            else:
                continue
            a = float(closes[sym].iloc[i])
            b = float(closes[sym].iloc[i + 1])
            if a <= 0:
                continue
            gross = sign * (b / a - 1.0)
            net = gross - ROUND_TRIP_PCT / 100.0
            trades.append(net * 100.0)
            daily.iloc[i + 1] += net / len(panel)
    return _finish(
        "module-10-daily-bias",
        "Module 10 — daily bias",
        [
            "Bias is long when close is above the SMA50, MACD is positive, and RSI is not extended. The mirror is short.",
            "Levels are classic floor pivots from the prior high, low, and close, plus the prior session range.",
            "A long bias earns the next close-to-close gain. A short bias earns the opposite.",
            "Neutral days stay in cash.",
        ],
        daily,
        bench,
        np.array(trades),
    )


RUNNERS = {
    "watchlist": run_watchlist,
    "donchian": run_donchian,
    "xs": run_xs,
    "opening_range": run_opening_range,
    "tema": run_tema,
    "carver": run_carver,
    "rotation": run_rotation,
    "triangle": run_triangle,
    "ema200": run_ema200,
    "kama": run_kama,
    "daily_bias": run_daily_bias,
}


def run_module(name: str, panel: dict[str, pd.DataFrame] | None = None) -> ModuleRun:
    if name not in RUNNERS:
        raise KeyError(name)
    return RUNNERS[name](panel)
