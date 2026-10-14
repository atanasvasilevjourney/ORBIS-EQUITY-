"""Pure rules for macro view and actionable setups (unit-testable)."""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import yaml

from pipeline.compute.daily_bias import swing_levels, trail_sma, wilder_atr, _px, _rr

CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"


def load_config(path: Path | None = None) -> dict[str, Any]:
    p = path or CONFIG_PATH
    with open(p, encoding="utf-8") as f:
        return yaml.safe_load(f)


def orbis_score(quality_rank: float | None, composite_factor: float | None) -> int | None:
    if quality_rank is None and composite_factor is None:
        return None
    q = float(quality_rank if quality_rank is not None else 50)
    c = float(composite_factor if composite_factor is not None else 50)
    return int(round(min(99, max(1, 0.6 * q + 0.4 * c))))


def week_start_for(d: date) -> date:
    return d - timedelta(days=d.weekday())


def theme_bucket(sector: str | None, themes: dict[str, Any]) -> str:
    if not sector:
        return str(themes.get("default_bucket", "general"))
    for bucket, spec in themes.items():
        if bucket == "default_bucket" or not isinstance(spec, dict):
            continue
        for s in spec.get("match_sectors") or []:
            if s.lower() in sector.lower() or sector.lower() in s.lower():
                return bucket
    return str(themes.get("default_bucket", "general"))


def build_macro_view(
    close: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    *,
    symbol: str,
    label: str,
    ma_period: int = 200,
    swing_lookback: int = 40,
) -> dict[str, Any] | None:
    if len(close) < ma_period + 5:
        return None
    last = float(close[-1])
    ma200 = trail_sma(close, ma_period)
    dist_pct = ((last / ma200) - 1.0) * 100.0 if ma200 else None
    atr = wilder_atr(high, low, close)
    sh, sl = swing_levels(high, low, lookback=swing_lookback)
    regime = "above_MA200" if last >= ma200 else "below_MA200"
    narrative_bits = [
        f"{label} ({symbol}) close {_px(last)}",
        f"{'above' if last >= ma200 else 'below'} MA{ma_period} ({_px(ma200)})",
    ]
    if dist_pct is not None:
        narrative_bits.append(f"{dist_pct:+.1f}% vs MA200")
    if sh:
        narrative_bits.append(f"resistance swing high {_px(sh)}")
    if sl:
        narrative_bits.append(f"support swing low {_px(sl)}")
    return {
        "symbol": symbol,
        "label": label,
        "last": _px(last),
        "ma200": _px(ma200),
        "distMa200Pct": round(dist_pct, 2) if dist_pct is not None else None,
        "regime": regime,
        "swingHigh": _px(sh) if sh else None,
        "swingLow": _px(sl) if sl else None,
        "atr14": _px(atr) if atr > 0 else None,
        "narrative": " · ".join(narrative_bits),
    }


def build_breakout_setup(
    close: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    *,
    stop_atr_mult: float,
    target_atr_mult: float,
    min_rr: float,
) -> dict[str, Any] | None:
    if len(close) < 60:
        return None
    last = float(close[-1])
    prior_h = float(high[-1])
    atr = wilder_atr(high, low, close)
    if atr <= 0:
        return None
    entry = _px(prior_h)
    stop = _px(prior_h - stop_atr_mult * atr)
    target = _px(prior_h + target_atr_mult * atr)
    rr = _rr(entry, target, stop, "LONG")
    if rr is None or rr < min_rr:
        return None
    if stop >= entry or entry >= target:
        return None
    return {
        "side": "LONG",
        "entry": entry,
        "stop": stop,
        "target": target,
        "rr": round(rr, 2),
        "kind": "breakout_prior_high",
        "trigger": "Enter only if price trades at or above entry (prior session high).",
        "status": "pending",
        "last": _px(last),
        "distanceToEntryPct": round(((entry / last) - 1.0) * 100.0, 2) if last > 0 else None,
    }


def score_candidate(
    radar: dict[str, Any],
    fund: dict[str, Any] | None,
    cfg: dict[str, Any],
) -> tuple[int | None, bool]:
    q = radar.get("quality_rank")
    cf = (fund or {}).get("composite_factor_score")
    score = orbis_score(
        float(q) if q is not None else None,
        float(cf) if cf is not None else None,
    )
    min_score = int(cfg.get("min_orbis_score", 70))
    min_q = int(cfg.get("min_quality_rank", 55))
    ok = score is not None and score >= min_score and (q is None or int(q) >= min_q)
    if cfg.get("require_radar_green") and radar.get("state") != 1:
        ok = False
    if cfg.get("require_breakout_or_volume"):
        if not (radar.get("breakout_active") or radar.get("volume_confirmed")):
            ok = False
    return score, ok


def rank_setups(candidates: list[dict[str, Any]], max_count: int) -> list[dict[str, Any]]:
    ordered = sorted(
        candidates,
        key=lambda x: (
            -(x.get("orbis_score") or 0),
            -(x.get("quality_rank") or 0),
            x.get("symbol") or "",
        ),
    )
    out: list[dict[str, Any]] = []
    for i, row in enumerate(ordered[:max_count], start=1):
        out.append({**row, "rank": i})
    return out
