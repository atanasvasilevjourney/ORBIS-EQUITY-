"""LOOP v2 — daily Donchian breakout with anchored VWAP entry/stop."""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date

import numpy as np
import pandas as pd

from pipeline.compute.atr_risk import compute_atr
from pipeline.compute.donchian_vwap import ENTRY_CHANNEL, MIN_PRICE
from pipeline.research.anchored_vwap import (
    anchored_vwap_on_day,
    anchored_vwap_series,
    lowest_low_anchor_day,
)
from pipeline.research.donchian_vwap_backtest import (
    _bar_ohlc,
    build_research_panels,
    run_donchian_vwap_portfolio,
)
from pipeline.research.loop_donchian_harness import compute_metrics, deflated_sharpe
from pipeline.research.merged_pit_universe import merged_membership_lookup
from pipeline.strategies.costs import CostModel, DEFAULT_LOOP_COSTS
from pipeline.strategies.execution import _loc_on, turnover_cost_fraction

MAX_NAMES = 30
MAX_PER_SECTOR = 6
MAX_WEIGHT = 2.0 / 30.0
VOL_TARGET = 0.15
ATR_PERIOD = 42
ATR_MULT = 5.0
LIMIT_SESSIONS = 10
SPIKE_WINDOW = 90
SPIKE_THRESHOLD = 0.15
MOM_SHORT = 21
MOM_LONG = 252


@dataclass
class PendingEntry:
    symbol: str
    breakout_day: date
    upper_level: float
    vwap_limit: float
    sessions_left: int
    sector: str
    stop_vwap_anchor: date


@dataclass
class OpenPosition:
    symbol: str
    sector: str
    entry_day: date
    entry_price: float
    breakout_day: date
    stop_vwap_anchor: date
    upper_level: float
    peak_close: float
    fill_mode: str  # "vwap_limit" | "next_open"
    stop_vwap_series: pd.Series | None = None


@dataclass
class LoopV2Config:
    name: str
    use_vwap_entry: bool = True
    use_vwap_stop: bool = True
    max_names: int = MAX_NAMES
    cost: CostModel = field(default_factory=lambda: DEFAULT_LOOP_COSTS)


def _series_close(spy: pd.DataFrame) -> pd.Series:
    col = spy["close"]
    if isinstance(col, pd.DataFrame):
        col = col.iloc[:, 0]
    return col.astype(float)


def _spy_regime_allowed(spy: pd.DataFrame, d: date) -> bool:
    loc = _loc_on(spy, d)
    if loc is None or loc < 200:
        return False
    close_s = _series_close(spy)
    close = float(close_s.iloc[loc])
    sma = float(close_s.iloc[: loc + 1].rolling(200).mean().iloc[-1])
    return close > sma


def _precompute_atr(ohlcv: pd.DataFrame, period: int = ATR_PERIOD) -> pd.Series:
    atr = compute_atr(ohlcv.reset_index(drop=True), period=period)
    if len(atr) != len(ohlcv):
        atr.index = range(len(ohlcv))
        atr.index = ohlcv.index
    else:
        atr.index = ohlcv.index
    return atr.astype(float)


def _precompute_features(ohlcv: pd.DataFrame) -> pd.DataFrame:
    d = ohlcv.sort_index().copy()
    high = d["high"].astype(float)
    low = d["low"].astype(float)
    close = d["close"].astype(float)
    upper = high.rolling(ENTRY_CHANNEL, min_periods=ENTRY_CHANNEL).max().shift(1)
    breakout = (close > upper) & upper.notna()
    ret = close.pct_change()
    spike = ret.abs().rolling(SPIKE_WINDOW, min_periods=SPIKE_WINDOW).max() >= SPIKE_THRESHOLD
    mom = close.shift(MOM_SHORT) / close.shift(MOM_LONG) - 1.0
    return pd.DataFrame(
        {
            "close": close,
            "high": high,
            "low": low,
            "open": d["open"].astype(float),
            "upper": upper,
            "breakout": breakout,
            "spike_skip": spike.fillna(False),
            "momentum": mom,
        },
        index=d.index,
    )


BreakoutEvent = tuple[str, float, float]  # sym, mom, upper


def _build_breakout_index(features: dict[str, pd.DataFrame]) -> dict[date, list[BreakoutEvent]]:
    by_day: dict[date, list[BreakoutEvent]] = defaultdict(list)
    for sym, feat in features.items():
        mask = feat["breakout"] & ~feat["spike_skip"] & (feat["close"] >= MIN_PRICE)
        if not mask.any():
            continue
        for ts, row in feat.loc[mask].iterrows():
            d = ts.date() if hasattr(ts, "date") else pd.Timestamp(ts).date()
            by_day[d].append((sym, float(row["momentum"]), float(row["upper"])))
    return dict(by_day)


def _bar_feat(feat: pd.DataFrame, d: date) -> pd.Series | None:
    ts = pd.Timestamp(d)
    hits = feat.index.normalize() == ts
    if not hits.any():
        return None
    return feat.iloc[int(np.where(hits)[0][0])]


def _precompute_vol20(panels: dict[str, pd.DataFrame], window: int = 20) -> dict[str, pd.Series]:
    out: dict[str, pd.Series] = {}
    for sym, ohlcv in panels.items():
        if sym == "SPY":
            continue
        out[sym] = ohlcv["close"].astype(float).pct_change().rolling(window).std()
    return out


def _inverse_vol_weights(
    symbols: list[str],
    d: date,
    vol20_cache: dict[str, pd.Series],
    panels: dict[str, pd.DataFrame],
) -> dict[str, float]:
    inv: dict[str, float] = {}
    for sym in symbols:
        vol_s = vol20_cache.get(sym)
        ohlcv = panels.get(sym)
        loc = _loc_on(ohlcv, d) if ohlcv is not None else None
        if vol_s is None or loc is None:
            continue
        vol = float(vol_s.iloc[loc])
        if not np.isfinite(vol) or vol <= 1e-8:
            vol = 0.02
        inv[sym] = 1.0 / vol
    if not inv:
        return {s: 1.0 / len(symbols) for s in symbols}
    total = sum(inv.values())
    w = {s: inv.get(s, 0.0) / total for s in symbols}
    for _ in range(4):
        clipped = {s: min(v, MAX_WEIGHT) for s, v in w.items()}
        excess = sum(w.values()) - sum(clipped.values())
        if excess <= 1e-9:
            w = clipped
            break
        free = [s for s, v in clipped.items() if v < MAX_WEIGHT - 1e-9]
        if not free:
            w = clipped
            break
        bump = excess / len(free)
        w = {s: (clipped[s] + bump if s in free else clipped[s]) for s in symbols}
    total = sum(w.values())
    return {s: w[s] / total for s in symbols} if total > 0 else {s: 1.0 / len(symbols) for s in symbols}


def _scale_vol_target(daily_hist: list[float], weights_gross: float) -> float:
    if len(daily_hist) < 20:
        return weights_gross
    vol = float(np.std(daily_hist[-20:])) * np.sqrt(252)
    if vol <= 1e-8:
        return weights_gross
    scale = min(1.0, VOL_TARGET / vol)
    return weights_gross * scale


def _stop_levels(
    pos: OpenPosition,
    panels: dict[str, pd.DataFrame],
    d: date,
    *,
    use_vwap_stop: bool,
    atr_cache: dict[str, pd.Series],
) -> tuple[float | None, float | None]:
    ohlcv = panels.get(pos.symbol)
    if ohlcv is None:
        return None, None
    atr = None
    bar = _bar_ohlc(ohlcv, d)
    if bar is not None:
        loc = _loc_on(ohlcv, d)
        if loc is not None and loc >= ATR_PERIOD:
            atr_s = atr_cache.get(pos.symbol)
            if atr_s is not None:
                atr = float(atr_s.iloc[loc])
    chandelier = None
    if atr is not None and np.isfinite(atr) and atr > 0:
        chandelier = pos.peak_close - ATR_MULT * atr
    vwap_floor = None
    if use_vwap_stop and pos.stop_vwap_series is not None:
        loc = _loc_on(ohlcv, d)
        if loc is not None:
            val = float(pos.stop_vwap_series.iloc[loc])
            vwap_floor = val if np.isfinite(val) else None
    elif use_vwap_stop:
        vwap_floor = anchored_vwap_on_day(ohlcv, pos.stop_vwap_anchor, d)
    if vwap_floor is not None and chandelier is not None:
        return max(vwap_floor, chandelier), chandelier
    if chandelier is not None:
        return chandelier, chandelier
    return vwap_floor, vwap_floor


def run_loop_v2(
    start: date,
    end: date,
    *,
    config: LoopV2Config,
    data_start: str = "2009-06-01",
    panels: dict[str, pd.DataFrame] | None = None,
    sym_sector: dict[str, str] | None = None,
    membership_lookup: Callable[[date], set[str]] | None = None,
    features: dict[str, pd.DataFrame] | None = None,
    atr_cache: dict[str, pd.Series] | None = None,
    breakout_index: dict[date, list[BreakoutEvent]] | None = None,
    vol20_cache: dict[str, pd.Series] | None = None,
) -> tuple[pd.Series, dict]:
    if membership_lookup is None:
        membership_lookup = merged_membership_lookup()
    if panels is None:
        panels, _, sym_sector = build_research_panels(data_start, sym_sector=sym_sector)
    if sym_sector is None:
        sym_sector = {k: "Unknown" for k in panels if k != "SPY"}

    spy = panels["SPY"]
    if features is None:
        features = {sym: _precompute_features(ohlcv) for sym, ohlcv in panels.items() if sym != "SPY"}
    if atr_cache is None:
        atr_cache = {sym: _precompute_atr(ohlcv) for sym, ohlcv in panels.items() if sym != "SPY"}
    if breakout_index is None:
        breakout_index = _build_breakout_index(features)
    if vol20_cache is None:
        vol20_cache = _precompute_vol20(panels)

    days = [d.date() if hasattr(d, "date") else d for d in spy.index]
    days = [d for d in days if start <= d <= end]

    positions: dict[str, OpenPosition] = {}
    pending: list[PendingEntry] = []
    weights: dict[str, float] = {}
    daily_rets: list[float] = []
    idx: list[pd.Timestamp] = []
    vwap_anchor_cache: dict[tuple[str, date], pd.Series] = {}

    def _vwap_on(sym: str, anchor: date, as_of: date) -> float | None:
        key = (sym, anchor)
        if key not in vwap_anchor_cache:
            ohlcv = panels.get(sym)
            if ohlcv is None:
                return None
            vwap_anchor_cache[key] = anchored_vwap_series(ohlcv, anchor)
        ohlcv = panels.get(sym)
        if ohlcv is None:
            return None
        loc = _loc_on(ohlcv, as_of)
        if loc is None:
            return None
        val = float(vwap_anchor_cache[key].iloc[loc])
        return val if np.isfinite(val) else None

    stats = {
        "vwap_limit_attempts": 0,
        "vwap_limit_fills": 0,
        "open_fallback_fills": 0,
        "turnover_days": 0.0,
        "holdings_sum": 0.0,
        "invested_days": 0,
    }

    for i, d in enumerate(days):
        signal_day = days[max(0, i - 1)]
        start_weights = dict(weights)

        # ---- exits ----
        to_close: list[str] = []
        gap_exits: list[str] = []
        close_exits: list[str] = []
        pit_today = membership_lookup(signal_day) if membership_lookup else None

        for sym, pos in list(positions.items()):
            ohlcv = panels.get(sym)
            stop, _ = _stop_levels(
                pos, panels, signal_day, use_vwap_stop=config.use_vwap_stop, atr_cache=atr_cache
            )
            if stop is None or ohlcv is None:
                continue
            bar = _bar_ohlc(ohlcv, d)
            if bar is None:
                continue
            hi, _, close = bar
            loc = _loc_on(ohlcv, d)
            op = float(ohlcv.iloc[loc]["open"]) if loc is not None else close
            pos.peak_close = max(pos.peak_close, close)
            if op < stop:
                to_close.append(sym)
                gap_exits.append(sym)
            elif close < stop:
                to_close.append(sym)
                close_exits.append(sym)
        for sym in to_close:
            positions.pop(sym, None)
            weights.pop(sym, None)

        # ---- fill pending entries ----
        still_pending: list[PendingEntry] = []
        new_entries: list[str] = []
        for pe in pending:
            if len(positions) >= config.max_names:
                still_pending.append(pe)
                continue
            ohlcv = panels.get(pe.symbol)
            if ohlcv is None:
                continue
            if config.use_vwap_entry:
                loc = _loc_on(ohlcv, d)
                if loc is None:
                    still_pending.append(pe)
                    continue
                upd_lim = _vwap_on(pe.symbol, pe.breakout_day, d)
                if upd_lim is not None:
                    pe.vwap_limit = upd_lim
                low = float(ohlcv.iloc[loc]["low"])
                if pe.sessions_left > 0 and low <= pe.vwap_limit:
                    stats["vwap_limit_fills"] += 1
                    op = float(ohlcv.iloc[loc]["open"])
                    fill_px = pe.vwap_limit if op > pe.vwap_limit else op
                    positions[pe.symbol] = OpenPosition(
                        symbol=pe.symbol,
                        sector=pe.sector,
                        entry_day=d,
                        entry_price=fill_px,
                        breakout_day=pe.breakout_day,
                        stop_vwap_anchor=pe.stop_vwap_anchor,
                        upper_level=pe.upper_level,
                        peak_close=fill_px,
                        fill_mode="vwap_limit",
                        stop_vwap_series=anchored_vwap_series(ohlcv, pe.stop_vwap_anchor),
                    )
                    new_entries.append(pe.symbol)
                    continue
                pe.sessions_left -= 1
                if pe.sessions_left <= 0:
                    feat = _bar_feat(features[pe.symbol], signal_day)
                    if feat is not None and float(feat["close"]) > pe.upper_level:
                        stats["open_fallback_fills"] += 1
                        if loc is not None:
                            fill_px = float(ohlcv.iloc[loc]["open"])
                            positions[pe.symbol] = OpenPosition(
                                symbol=pe.symbol,
                                sector=pe.sector,
                                entry_day=d,
                                entry_price=fill_px,
                                breakout_day=pe.breakout_day,
                                stop_vwap_anchor=pe.stop_vwap_anchor,
                                upper_level=pe.upper_level,
                                peak_close=fill_px,
                                fill_mode="next_open",
                                stop_vwap_series=anchored_vwap_series(ohlcv, pe.stop_vwap_anchor),
                            )
                            new_entries.append(pe.symbol)
                        continue
                still_pending.append(pe)
            else:
                if pe.symbol not in positions:
                    loc = _loc_on(ohlcv, d)
                    if loc is not None:
                        fill_px = float(ohlcv.iloc[loc]["open"])
                        positions[pe.symbol] = OpenPosition(
                            symbol=pe.symbol,
                            sector=pe.sector,
                            entry_day=d,
                            entry_price=fill_px,
                            breakout_day=pe.breakout_day,
                            stop_vwap_anchor=pe.stop_vwap_anchor,
                            upper_level=pe.upper_level,
                            peak_close=fill_px,
                            fill_mode="next_open",
                            stop_vwap_series=anchored_vwap_series(ohlcv, pe.stop_vwap_anchor),
                        )
                        new_entries.append(pe.symbol)
        pending = [p for p in still_pending if p.symbol not in positions]

        # ---- scan breakouts on signal_day ----
        if _spy_regime_allowed(spy, signal_day):
            cands: list[tuple[str, float]] = []
            sector_count: dict[str, int] = {}
            for sym in positions:
                sec = sym_sector.get(sym, "Unknown")
                sector_count[sec] = sector_count.get(sec, 0) + 1
            for pe in pending:
                sector_count[pe.sector] = sector_count.get(pe.sector, 0) + 0  # pending counts on fill

            for sym, mom, upper in breakout_index.get(signal_day, []):
                if pit_today is not None and sym not in pit_today:
                    continue
                if sym in positions or any(p.symbol == sym for p in pending):
                    continue
                if sector_count.get(sym_sector.get(sym, "Unknown"), 0) >= MAX_PER_SECTOR:
                    continue
                cands.append((sym, mom if np.isfinite(mom) else -999.0))
            slots = config.max_names - len(positions) - len(pending)
            if slots > 0 and cands:
                cands.sort(key=lambda x: -x[1])
                for sym, _ in cands[:slots]:
                    ev = next(e for e in breakout_index.get(signal_day, []) if e[0] == sym)
                    _, _, upper = ev
                    ohlcv = panels.get(sym)
                    anchor = (
                        lowest_low_anchor_day(ohlcv, signal_day, ENTRY_CHANNEL)
                        if ohlcv is not None
                        else signal_day
                    ) or signal_day
                    vwap_lim = _vwap_on(sym, signal_day, signal_day)
                    if vwap_lim is None:
                        row = _bar_feat(features[sym], signal_day)
                        vwap_lim = float(row["close"]) if row is not None else upper
                    sec = sym_sector.get(sym, "Unknown")
                    if config.use_vwap_entry:
                        stats["vwap_limit_attempts"] += 1
                        pending.append(
                            PendingEntry(
                                symbol=sym,
                                breakout_day=signal_day,
                                upper_level=upper,
                                vwap_limit=vwap_lim,
                                sessions_left=LIMIT_SESSIONS,
                                sector=sec,
                                stop_vwap_anchor=anchor,
                            )
                        )
                    else:
                        pending.append(
                            PendingEntry(
                                symbol=sym,
                                breakout_day=signal_day,
                                upper_level=upper,
                                vwap_limit=vwap_lim,
                                sessions_left=0,
                                sector=sec,
                                stop_vwap_anchor=anchor,
                            )
                        )

        held = list(positions.keys())
        if held:
            raw_w = _inverse_vol_weights(held, signal_day, vol20_cache, panels)
            gross = sum(raw_w.values())
            scale = _scale_vol_target(daily_rets, gross)
            weights = {s: raw_w[s] * scale for s in held}
            stats["holdings_sum"] += len(held)
            if scale > 0.01:
                stats["invested_days"] += 1
        else:
            weights = {}

        # ---- daily P&L ----
        day_ret = 0.0
        start_syms = set(start_weights.keys())
        end_syms = set(weights.keys())
        for sym in start_syms & end_syms:
            if sym in new_entries:
                continue
            ohlcv = panels.get(sym)
            if ohlcv is None:
                continue
            w = start_weights.get(sym, 0.0)
            loc = _loc_on(ohlcv, d)
            if loc is None or loc == 0:
                continue
            prev_c = float(ohlcv.iloc[loc - 1]["close"])
            cl = float(ohlcv.iloc[loc]["close"])
            if prev_c > 0:
                day_ret += w * (cl / prev_c - 1.0)
        for sym in gap_exits:
            ohlcv = panels.get(sym)
            w = start_weights.get(sym, 0.0)
            loc = _loc_on(ohlcv, d)
            if ohlcv is None or loc is None or loc == 0:
                continue
            prev_c = float(ohlcv.iloc[loc - 1]["close"])
            op = float(ohlcv.iloc[loc]["open"])
            if prev_c > 0:
                day_ret += w * (op / prev_c - 1.0)
        for sym in close_exits:
            if sym in gap_exits:
                continue
            ohlcv = panels.get(sym)
            w = start_weights.get(sym, 0.0)
            loc = _loc_on(ohlcv, d)
            if ohlcv is None or loc is None or loc == 0:
                continue
            prev_c = float(ohlcv.iloc[loc - 1]["close"])
            cl = float(ohlcv.iloc[loc]["close"])
            if prev_c > 0:
                day_ret += w * (cl / prev_c - 1.0)
        for sym in new_entries:
            ohlcv = panels.get(sym)
            w = weights.get(sym, 0.0)
            loc = _loc_on(ohlcv, d)
            if ohlcv is None or loc is None:
                continue
            op = float(ohlcv.iloc[loc]["open"])
            cl = float(ohlcv.iloc[loc]["close"])
            fill = positions[sym].entry_price
            if op > 0 and fill > 0:
                if fill <= op:
                    day_ret += w * (cl / fill - 1.0)
                else:
                    day_ret += w * ((cl / op - 1.0) + (op / fill - 1.0))

        if start_syms != end_syms or new_entries or to_close:
            stats["turnover_days"] += 1.0
        if config.cost is not None:
            day_ret -= turnover_cost_fraction(start_syms, end_syms, config.cost)

        daily_rets.append(day_ret)
        idx.append(pd.Timestamp(d))

    daily = pd.Series(daily_rets, index=idx)
    n = max(len(days), 1)
    stats["avg_holdings"] = stats["holdings_sum"] / n
    stats["pct_time_invested"] = 100.0 * stats["invested_days"] / n
    denom = stats["vwap_limit_attempts"]
    stats["vwap_limit_fill_rate"] = (
        100.0 * stats["vwap_limit_fills"] / denom if denom else 0.0
    )
    return daily, stats


def run_baseline_loop(
    start: date,
    end: date,
    *,
    data_start: str = "2009-06-01",
    panels=None,
    signals=None,
    sym_sector=None,
    membership_lookup: Callable[[date], set[str]] | None = None,
    cost: CostModel = DEFAULT_LOOP_COSTS,
) -> tuple[pd.Series, dict]:
    """Current LOOP: Donchian 55 + VWAP(20), max 8, ATR(14)×k weekly rebalance."""
    daily, eq_df = run_donchian_vwap_portfolio(
        start,
        end,
        data_start=data_start,
        exit_mode="atr_trail",
        atr_period=14,
        atr_mult=3.0,
        rotation_mode="weekly",
        panels=panels,
        signals=signals,
        sym_sector=sym_sector,
        membership_lookup=membership_lookup,
        cost=cost,
    )
    stats: dict = {}
    if eq_df is not None and not eq_df.empty and "names" in eq_df.columns:
        stats["avg_holdings"] = float(eq_df["names"].mean())
        stats["pct_time_invested"] = 100.0 * float((eq_df["names"] > 0).mean())
    return daily, stats


def summarize_run(
    name: str,
    daily: pd.Series,
    start: date,
    end: date,
    *,
    extra: dict | None = None,
    n_trials: int = 6,
) -> dict:
    mask = (daily.index >= pd.Timestamp(start)) & (daily.index <= pd.Timestamp(end))
    r = daily.loc[mask].dropna()
    m = compute_metrics(r)
    years: dict[str, float] = {}
    if not r.empty:
        for yr, grp in r.groupby(r.index.year):
            years[str(yr)] = float((1 + grp).prod() - 1.0)
    out = {
        "name": name,
        "cagr": m.cagr,
        "total_return": m.total_return,
        "annualized_vol": float(r.std() * np.sqrt(252)) if len(r) > 1 else 0.0,
        "sharpe": m.sharpe,
        "deflated_sharpe": deflated_sharpe(m.sharpe, len(r), n_trials),
        "max_drawdown": m.max_dd,
        "turnover": (extra or {}).get("turnover_days", 0) / max(len(r), 1) * 252,
        "avg_holdings": (extra or {}).get("avg_holdings", 0),
        "pct_time_invested": (extra or {}).get("pct_time_invested", 0),
        "vwap_limit_fill_rate": (extra or {}).get("vwap_limit_fill_rate", 0),
        "per_year_returns": years,
        "days": len(r),
    }
    return out