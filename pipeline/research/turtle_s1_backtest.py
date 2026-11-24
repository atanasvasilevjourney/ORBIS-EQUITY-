"""Turtle Trading System 1 — 20/10 Donchian breakout (long-only, research)."""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date

import numpy as np
import pandas as pd

from pipeline.compute.atr_risk import compute_atr
from pipeline.compute.donchian_vwap import MIN_PRICE
from pipeline.compute.donchian_vwap import EQUITY as INITIAL_EQUITY
from pipeline.research.loop_donchian_harness import compute_metrics, deflated_sharpe
from pipeline.research.merged_pit_universe import merged_membership_lookup
from pipeline.strategies.costs import CostModel, DEFAULT_LOOP_COSTS
from pipeline.strategies.execution import _loc_on, turnover_cost_fraction

ENTRY_DAYS = 20
EXIT_DAYS = 10
ATR_PERIOD = 20
STOP_N_MULT = 2.0
RISK_PCT = 0.01
MAX_WEIGHT = 0.10
MAX_GROSS = 1.0
PYRAMID_STEP_N = 0.5
MAX_UNITS = 4
SMA_FILTER = 200


def prior_donchian_high(high: pd.Series, window: int = ENTRY_DAYS) -> pd.Series:
    """Rolling max of high over *window* days, excluding the current bar."""
    return high.rolling(window, min_periods=window).max().shift(1)


def prior_donchian_low(low: pd.Series, window: int = EXIT_DAYS) -> pd.Series:
    """Rolling min of low over *window* days, excluding the current bar."""
    return low.rolling(window, min_periods=window).min().shift(1)


def turtle_unit_shares(equity: float, n: float) -> float:
  if n <= 0 or not np.isfinite(n) or equity <= 0:
    return 0.0
  return (RISK_PCT * equity) / n


def cap_unit_weight(shares: float, price: float, equity: float) -> float:
  if equity <= 0 or price <= 0 or shares <= 0:
    return 0.0
  raw = shares * price / equity
  return min(raw, MAX_WEIGHT)


def should_skip_entry(last_winner: bool | None, use_skip_rule: bool) -> bool:
  return bool(use_skip_rule and last_winner is True)


def next_pyramid_add_price(last_add: float, n: float, step: float = PYRAMID_STEP_N) -> float:
  return last_add + step * n


@dataclass
class TurtleS1Config:
  name: str
  use_skip_rule: bool = True
  use_sma200_filter: bool = False
  allow_pyramid: bool = False
  cost: CostModel = field(default_factory=lambda: DEFAULT_LOOP_COSTS)


@dataclass
class _LivePos:
  symbol: str
  entry_day: date
  entry_price: float
  n_at_entry: float
  stop_price: float
  units: int
  last_add_price: float
  unit_shares: float
  weight: float


@dataclass
class _ShadowPos:
  symbol: str
  entry_day: date
  entry_price: float
  n_at_entry: float
  stop_price: float


BreakoutEvent = tuple[str, float, float]  # sym, strength, upper


def _bar_ohlc(ohlcv: pd.DataFrame, d: date) -> tuple[float, float, float] | None:
  loc = _loc_on(ohlcv, d)
  if loc is None:
    return None
  row = ohlcv.iloc[loc]
  return float(row["high"]), float(row["low"]), float(row["close"])


def precompute_features(ohlcv: pd.DataFrame) -> pd.DataFrame:
  d = ohlcv.sort_index().copy()
  high = d["high"].astype(float)
  low = d["low"].astype(float)
  close = d["close"].astype(float)
  upper = prior_donchian_high(high, ENTRY_DAYS)
  lower = prior_donchian_low(low, EXIT_DAYS)
  atr = compute_atr(d.reset_index(drop=True), period=ATR_PERIOD)
  atr.index = d.index
  sma200 = close.rolling(SMA_FILTER, min_periods=SMA_FILTER).mean()
  strength = (close / upper.replace(0, np.nan) - 1.0).clip(lower=0).fillna(0)
  breakout = (close > upper) & upper.notna() & (close >= MIN_PRICE)
  exit_channel = (close < lower) & lower.notna()
  return pd.DataFrame(
    {
      "open": d["open"].astype(float),
      "high": high,
      "low": low,
      "close": close,
      "upper": upper,
      "lower": lower,
      "atr": atr.astype(float),
      "sma200": sma200,
      "strength": strength,
      "breakout": breakout,
      "exit_channel": exit_channel,
      "above_sma200": close > sma200,
    },
    index=d.index,
  )


def build_breakout_index(
  features: dict[str, pd.DataFrame],
  *,
  use_sma200_filter: bool,
) -> dict[date, list[BreakoutEvent]]:
  by_day: dict[date, list[BreakoutEvent]] = defaultdict(list)
  for sym, feat in features.items():
    mask = feat["breakout"]
    if use_sma200_filter:
      mask = mask & feat["above_sma200"].fillna(False)
    if not mask.any():
      continue
    for ts, row in feat.loc[mask].iterrows():
      d = ts.date() if hasattr(ts, "date") else pd.Timestamp(ts).date()
      by_day[d].append((sym, float(row["strength"]), float(row["upper"])))
  return dict(by_day)


def _bar_feat(feat: pd.DataFrame, d: date) -> pd.Series | None:
  ts = pd.Timestamp(d)
  hits = feat.index.normalize() == ts
  if not hits.any():
    return None
  return feat.iloc[int(np.where(hits)[0][0])]


def _record_trade(
  trades: list[dict],
  sym: str,
  entry_day: date,
  entry_px: float,
  exit_day: date,
  exit_px: float,
  n: float,
  shares: float,
  units: int,
) -> None:
  if entry_px <= 0 or exit_px <= 0 or shares <= 0 or n <= 0:
    return
  pnl = (exit_px - entry_px) * shares * units
  risk_dollars = STOP_N_MULT * n * shares * units
  r_mult = pnl / risk_dollars if risk_dollars > 0 else 0.0
  trades.append(
    {
      "symbol": sym,
      "entry_day": entry_day.isoformat(),
      "exit_day": exit_day.isoformat(),
      "entry_price": entry_px,
      "exit_price": exit_px,
      "units": units,
      "win": exit_px > entry_px,
      "holding_days": (exit_day - entry_day).days,
      "r_multiple": r_mult,
      "pnl": pnl,
    }
  )


def run_turtle_s1(
  start: date,
  end: date,
  *,
  config: TurtleS1Config,
  panels: dict[str, pd.DataFrame],
  membership_lookup: Callable[[date], set[str]] | None = None,
  features: dict[str, pd.DataFrame] | None = None,
  breakout_index: dict[date, list[BreakoutEvent]] | None = None,
) -> tuple[pd.Series, dict]:
  if membership_lookup is None:
    membership_lookup = merged_membership_lookup()

  spy = panels["SPY"]
  if features is None:
    features = {sym: precompute_features(ohlcv) for sym, ohlcv in panels.items() if sym != "SPY"}
  if breakout_index is None:
    breakout_index = build_breakout_index(features, use_sma200_filter=config.use_sma200_filter)

  days = [d.date() if hasattr(d, "date") else d for d in spy.index]
  days = [d for d in days if start <= d <= end]

  positions: dict[str, _LivePos] = {}
  shadows: dict[str, _ShadowPos] = {}
  last_outcome: dict[str, bool | None] = {}

  weights: dict[str, float] = {}
  equity = float(INITIAL_EQUITY)
  daily_rets: list[float] = []
  idx: list[pd.Timestamp] = []
  trades: list[dict] = []

  stats = {
    "turnover_days": 0.0,
    "holdings_sum": 0.0,
    "invested_days": 0,
    "skip_signals": 0,
    "skip_rule_opportunities": 0,
  }

  for i, d in enumerate(days):
    signal_day = days[max(0, i - 1)]
    start_weights = dict(weights)

    gap_exits: list[str] = []
    close_exits: list[str] = []
    stop_exits: list[str] = []
    pit = membership_lookup(signal_day)

    # Channel exits from prior close signal
    for sym, pos in list(positions.items()):
      feat = features.get(sym)
      row = _bar_feat(feat, signal_day) if feat is not None else None
      if row is not None and bool(row["exit_channel"]):
        close_exits.append(sym)

    for sym, pos in list(positions.items()):
      if sym in close_exits:
        continue
      ohlcv = panels.get(sym)
      bar = _bar_ohlc(ohlcv, d) if ohlcv is not None else None
      if bar is None:
        continue
      hi, lo, _ = bar
      loc = _loc_on(ohlcv, d)
      op = float(ohlcv.iloc[loc]["open"]) if loc is not None else hi
      if op <= pos.stop_price:
        gap_exits.append(sym)
        stop_exits.append(sym)
      elif lo <= pos.stop_price:
        stop_exits.append(sym)

    exits_all = set(close_exits) | set(stop_exits)
    exit_px_by_sym: dict[str, float] = {}
    new_entries: list[str] = []
    pyramid_adds: dict[str, tuple[float, float]] = {}

    for sym in list(exits_all):
      pos = positions.get(sym)
      if pos is None:
        continue
      ohlcv = panels.get(sym)
      if ohlcv is None:
        continue
      loc = _loc_on(ohlcv, d)
      if loc is None:
        continue
      if sym in gap_exits or sym in close_exits:
        exit_px = float(ohlcv.iloc[loc]["open"])
      else:
        exit_px = pos.stop_price
      exit_px_by_sym[sym] = exit_px
      positions.pop(sym, None)
      weights.pop(sym, None)
      _record_trade(
        trades,
        sym,
        pos.entry_day,
        pos.entry_price,
        d,
        exit_px,
        pos.n_at_entry,
        pos.unit_shares,
        pos.units,
      )
      last_outcome[sym] = exit_px > pos.entry_price

    # Shadow (skipped would-be) trades — same exit rules
    for sym, shadow in list(shadows.items()):
      feat = features.get(sym)
      row = _bar_feat(feat, signal_day) if feat is not None else None
      shadow_close = row is not None and bool(row["exit_channel"])
      ohlcv = panels.get(sym)
      bar = _bar_ohlc(ohlcv, d) if ohlcv is not None else None
      shadow_stop = False
      if bar is not None:
        _, lo, _ = bar
        loc = _loc_on(ohlcv, d)
        op = float(ohlcv.iloc[loc]["open"]) if loc is not None else lo
        if op <= shadow.stop_price or lo <= shadow.stop_price:
          shadow_stop = True
      if shadow_close or shadow_stop:
        if ohlcv is not None:
          loc = _loc_on(ohlcv, d)
          if loc is not None:
            exit_px = (
              float(ohlcv.iloc[loc]["open"])
              if shadow_close
              else shadow.stop_price
            )
            last_outcome[sym] = exit_px > shadow.entry_price
        shadows.pop(sym, None)

    # Pyramid adds (evaluate breakout day high on signal_day, fill at open d)
    if config.allow_pyramid:
      for sym, pos in list(positions.items()):
        if pos.units >= MAX_UNITS:
          continue
        feat = features.get(sym)
        row = _bar_feat(feat, signal_day) if feat is not None else None
        if row is None:
          continue
        thr = next_pyramid_add_price(pos.last_add_price, pos.n_at_entry)
        if float(row["high"]) < thr:
          continue
        ohlcv = panels.get(sym)
        if ohlcv is None:
          continue
        loc = _loc_on(ohlcv, d)
        if loc is None:
          continue
        add_px = float(ohlcv.iloc[loc]["open"])
        add_shares = turtle_unit_shares(equity, pos.n_at_entry)
        add_w = cap_unit_weight(add_shares, add_px, equity)
        gross = sum(weights.values())
        if add_w <= 0 or gross + add_w > MAX_GROSS + 1e-9:
          continue
        if weights.get(sym, 0) + add_w > MAX_WEIGHT + 1e-9:
          room = MAX_WEIGHT - weights.get(sym, 0)
          if room <= 1e-9:
            continue
          add_w = room
        pos.units += 1
        pos.last_add_price = add_px
        pos.stop_price = add_px - STOP_N_MULT * pos.n_at_entry
        weights[sym] = weights.get(sym, 0.0) + add_w
        pyramid_adds[sym] = (add_w, add_px)

    # Breakout entries: signal on signal_day close, fill at open d
    entry_candidates: list[tuple[str, float, float]] = []
    for sym, strength, _upper in breakout_index.get(signal_day, []):
      if pit is not None and sym not in pit:
        continue
      if sym in positions or sym in shadows:
        continue
      feat = features.get(sym)
      row = _bar_feat(feat, signal_day) if feat is not None else None
      if row is None:
        continue
      n_val = float(row["atr"])
      if not np.isfinite(n_val) or n_val <= 0:
        continue
      if should_skip_entry(last_outcome.get(sym), config.use_skip_rule):
        stats["skip_rule_opportunities"] += 1
        stats["skip_signals"] += 1
        ohlcv = panels.get(sym)
        loc_next = _loc_on(ohlcv, d) if ohlcv is not None else None
        if ohlcv is not None and loc_next is not None:
          entry_px = float(ohlcv.iloc[loc_next]["open"])
          shadows[sym] = _ShadowPos(
            symbol=sym,
            entry_day=d,
            entry_price=entry_px,
            n_at_entry=n_val,
            stop_price=entry_px - STOP_N_MULT * n_val,
          )
        continue
      entry_candidates.append((sym, strength, n_val))

    entry_candidates.sort(key=lambda x: -x[1])
    gross = sum(weights.values())
    for sym, _strength, n_val in entry_candidates:
      if sym in positions:
        continue
      ohlcv = panels.get(sym)
      if ohlcv is None:
        continue
      loc = _loc_on(ohlcv, d)
      if loc is None:
        continue
      entry_px = float(ohlcv.iloc[loc]["open"])
      shares = turtle_unit_shares(equity, n_val)
      w = cap_unit_weight(shares, entry_px, equity)
      if w <= 0:
        continue
      if gross + w > MAX_GROSS + 1e-9:
        remain = MAX_GROSS - gross
        if remain <= 1e-9:
          break
        w = min(w, remain)
      positions[sym] = _LivePos(
        symbol=sym,
        entry_day=d,
        entry_price=entry_px,
        n_at_entry=n_val,
        stop_price=entry_px - STOP_N_MULT * n_val,
        units=1,
        last_add_price=entry_px,
        unit_shares=shares,
        weight=w,
      )
      weights[sym] = w
      gross += w
      new_entries.append(sym)

    held = list(weights.keys())
    stats["holdings_sum"] += len(held)
    if held:
      stats["invested_days"] += 1

    # Daily P&L
    day_ret = 0.0
    start_syms = set(start_weights.keys())
    end_syms = set(weights.keys())
    all_exits = set(close_exits) | set(stop_exits)

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
      if sym in pyramid_adds:
        add_w, add_px = pyramid_adds[sym]
        op = float(ohlcv.iloc[loc]["open"])
        if add_px > 0 and op > 0:
          if add_px <= op:
            day_ret += add_w * (cl / add_px - 1.0)
          else:
            day_ret += add_w * ((cl / op - 1.0) + (op / add_px - 1.0))

    for sym in all_exits:
      ohlcv = panels.get(sym)
      w = start_weights.get(sym, 0.0)
      loc = _loc_on(ohlcv, d)
      if ohlcv is None or loc is None or loc == 0:
        continue
      prev_c = float(ohlcv.iloc[loc - 1]["close"])
      exit_px = exit_px_by_sym.get(sym)
      if exit_px is None:
        continue
      if prev_c > 0:
        day_ret += w * (exit_px / prev_c - 1.0)

    for sym in new_entries:
      ohlcv = panels.get(sym)
      w = weights.get(sym, 0.0)
      loc = _loc_on(ohlcv, d)
      if ohlcv is None or loc is None:
        continue
      op = float(ohlcv.iloc[loc]["open"])
      cl = float(ohlcv.iloc[loc]["close"])
      fill = positions[sym].entry_price if sym in positions else op
      if op > 0 and fill > 0:
        if fill <= op:
          day_ret += w * (cl / fill - 1.0)
        else:
          day_ret += w * ((cl / op - 1.0) + (op / fill - 1.0))

    if start_syms != end_syms or new_entries or all_exits:
      stats["turnover_days"] += 1.0
    if config.cost is not None:
      day_ret -= turnover_cost_fraction(start_syms, end_syms, config.cost)

    equity *= 1.0 + day_ret
    daily_rets.append(day_ret)
    idx.append(pd.Timestamp(d))

  daily = pd.Series(daily_rets, index=idx)
  n = max(len(days), 1)
  stats["avg_holdings"] = stats["holdings_sum"] / n
  stats["pct_time_invested"] = 100.0 * stats["invested_days"] / n

  if trades:
    wins = [t for t in trades if t["win"]]
    losses = [t for t in trades if not t["win"]]
    stats["trade_count"] = len(trades)
    stats["win_rate"] = 100.0 * len(wins) / len(trades)
    stats["avg_holding_days"] = float(np.mean([t["holding_days"] for t in trades]))
    stats["avg_r_multiple"] = float(np.mean([t["r_multiple"] for t in trades]))
    avg_win = float(np.mean([t["r_multiple"] for t in wins])) if wins else 0.0
    avg_loss = float(np.mean([abs(t["r_multiple"]) for t in losses])) if losses else 0.0
    stats["payoff_ratio"] = avg_win / avg_loss if avg_loss > 0 else 0.0
  else:
    stats["trade_count"] = 0
    stats["win_rate"] = 0.0
    stats["avg_holding_days"] = 0.0
    stats["avg_r_multiple"] = 0.0
    stats["payoff_ratio"] = 0.0

  stats["trades"] = trades
  return daily, stats


def summarize_run(
  name: str,
  daily: pd.Series,
  start: date,
  end: date,
  *,
  extra: dict | None = None,
  n_trials: int = 14,
) -> dict:
  mask = (daily.index >= pd.Timestamp(start)) & (daily.index <= pd.Timestamp(end))
  r = daily.loc[mask].dropna()
  m = compute_metrics(r)
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
    "trade_count": (extra or {}).get("trade_count", 0),
    "win_rate": (extra or {}).get("win_rate", 0),
    "avg_holding_days": (extra or {}).get("avg_holding_days", 0),
    "avg_r_multiple": (extra or {}).get("avg_r_multiple", 0),
    "payoff_ratio": (extra or {}).get("payoff_ratio", 0),
    "skip_signals": (extra or {}).get("skip_signals", 0),
    "skip_rule_opportunities": (extra or {}).get("skip_rule_opportunities", 0),
    "days": len(r),
  }
  return out