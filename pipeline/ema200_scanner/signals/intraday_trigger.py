"""Phase 3 — 5m triggers against the daily EMA200 ribbon (bar close, RTH)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import pandas as pd

from pipeline.ema200_scanner.config.loader import load_config

TriggerType = Literal["INTRADAY_AT_RIBBON", "INTRADAY_RECLAIM"]

NY = "America/New_York"


@dataclass(frozen=True)
class IntradayTrigger:
    symbol: str
    trigger_type: TriggerType
    bar_ts: str
    session_date: str
    close: float
    ema200_daily: float
    ribbon_dist_atr: float
    rvol_5m: float | None
    score: float
    held: bool


def phase3_config(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = cfg or load_config()
    p3 = dict(cfg.get("phase3") or {})
    touch = cfg.get("touch", {})
    wl = cfg.get("watchlist", {})
    return {
        "enabled": bool(p3.get("enabled", True)),
        "interval": str(p3.get("interval", "5m")),
        "range": str(p3.get("range", "5d")),
        "rth_only": bool(p3.get("rth_only", True)),
        "session_start": str(p3.get("session_start", "09:30")),
        "session_end": str(p3.get("session_end", "16:00")),
        "shortlist_atr": float(touch.get("shortlist_atr", 1.5)),
        "volume_confirm_ratio": float(p3.get("volume_confirm_ratio", 1.2)),
        "volume_lookback_bars": int(p3.get("volume_lookback_bars", 20)),
        "require_daily_watchlist": bool(p3.get("require_daily_watchlist", True)),
        "confirm_mode": str(p3.get("confirm_mode", touch.get("confirm_mode", "bar_close"))),
        "min_days_above": int(wl.get("min_days_above", 20)),
        "min_slope": float(wl.get("min_slope", 0.0)),
    }


def _parse_hm(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def is_rth_bar(ts: pd.Timestamp, cfg: dict[str, Any]) -> bool:
    if not cfg.get("rth_only", True):
        return True
    t = ts.tz_convert(NY) if ts.tzinfo else ts.tz_localize("UTC").tz_convert(NY)
    mins = t.hour * 60 + t.minute
    start = _parse_hm(str(cfg.get("session_start", "09:30")))
    end = _parse_hm(str(cfg.get("session_end", "16:00")))
    return start <= mins <= end


def _volume_ok(row: pd.Series, cfg: dict[str, Any]) -> bool:
    rvol = row.get("rvol_5m")
    if rvol is None or pd.isna(rvol):
        return True
    return float(rvol) >= float(cfg["volume_confirm_ratio"])


def score_trigger(dist_atr: float, rvol: float | None, cfg: dict[str, Any]) -> float:
    cap = float(cfg["shortlist_atr"])
    dist = max(0.0, float(dist_atr))
    base = max(0.0, 100.0 - (dist / cap) * 35.0)
    if rvol is not None and not pd.isna(rvol) and float(rvol) >= cfg["volume_confirm_ratio"]:
        base += 5.0
    return float(min(100.0, base))


def detect_intraday_triggers(
    symbol: str,
    merged: pd.DataFrame,
    *,
    daily_setup: str | None,
    cfg: dict[str, Any] | None = None,
    live_last_bar_only: bool = True,
) -> list[IntradayTrigger]:
    """Detect Phase 3 triggers on bars with ``attach_daily_ema200_step`` columns."""
    cfg = phase3_config(cfg)
    if not cfg.get("enabled", True):
        return []
    if cfg.get("require_daily_watchlist") and daily_setup is None:
        return []

    out: list[IntradayTrigger] = []
    if merged.empty:
        return out

    idx_list = list(merged.index)
    if len(idx_list) < 2:
        return out
    indices = [len(idx_list) - 1] if live_last_bar_only else range(1, len(idx_list))

    for i in indices:
        ts = idx_list[i]
        if not is_rth_bar(ts, cfg):
            continue
        row = merged.iloc[i]
        prev = merged.iloc[i - 1]
        ema = row.get("ema200_daily")
        if ema is None or pd.isna(ema):
            continue
        dist = row.get("ribbon_dist_atr_daily")
        if dist is None or pd.isna(dist):
            continue
        dist_f = abs(float(dist))
        close_f = float(row["close"])
        ema_f = float(ema)
        held = close_f >= ema_f
        rvol = None if pd.isna(row.get("rvol_5m")) else float(row["rvol_5m"])
        bar_ts = ts.isoformat()
        session_date = ts.date().isoformat()

        at_ribbon = dist_f <= float(cfg["shortlist_atr"]) and held
        if at_ribbon and _volume_ok(row, cfg):
            out.append(
                IntradayTrigger(
                    symbol=symbol,
                    trigger_type="INTRADAY_AT_RIBBON",
                    bar_ts=bar_ts,
                    session_date=session_date,
                    close=close_f,
                    ema200_daily=ema_f,
                    ribbon_dist_atr=dist_f,
                    rvol_5m=rvol,
                    score=score_trigger(dist_f, rvol, cfg),
                    held=held,
                )
            )

        prev_close = float(prev["close"])
        prev_ema = prev.get("ema200_daily")
        prev_dist = prev.get("ribbon_dist_atr_daily")
        if prev_ema is None or pd.isna(prev_ema):
            continue
        prev_ema_f = float(prev_ema)
        prev_dist_f = abs(float(prev_dist)) if prev_dist is not None and not pd.isna(prev_dist) else 999.0
        dipped = prev_close < prev_ema_f or prev_dist_f > float(cfg["shortlist_atr"])
        reclaim = dipped and held and dist_f <= float(cfg["shortlist_atr"]) and _volume_ok(row, cfg)
        if reclaim and daily_setup != "RETRACE_HELD":
            reclaim = False
        if reclaim:
            out.append(
                IntradayTrigger(
                    symbol=symbol,
                    trigger_type="INTRADAY_RECLAIM",
                    bar_ts=bar_ts,
                    session_date=session_date,
                    close=close_f,
                    ema200_daily=ema_f,
                    ribbon_dist_atr=dist_f,
                    rvol_5m=rvol,
                    score=score_trigger(dist_f, rvol, cfg),
                    held=held,
                )
            )
    # Prefer reclaim over at-ribbon on the same bar
    if len(out) > 1:
        types = {t.trigger_type for t in out}
        if "INTRADAY_RECLAIM" in types and "INTRADAY_AT_RIBBON" in types:
            out = [t for t in out if t.trigger_type != "INTRADAY_AT_RIBBON"]
    return out


def triggers_to_event_rows(triggers: list[IntradayTrigger]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for t in triggers:
        rows.append(
            {
                "symbol": t.symbol,
                "bar_date": t.session_date,
                "event_type": t.trigger_type,
                "score": t.score,
                "features": {
                    "bar_ts": t.bar_ts,
                    "close": t.close,
                    "ema200_daily": t.ema200_daily,
                    "ribbon_dist_atr": t.ribbon_dist_atr,
                    "rvol_5m": t.rvol_5m,
                    "held": t.held,
                    "phase": 3,
                },
            }
        )
    return rows
