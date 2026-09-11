"""Beta rotational sector / industry tape.

Inspired by Caltropia's 2026 sector & industry outlook *structure*
(current / momentum / value / low-vol breadth, weekly impulse, stretch)
plus a 60-day OLS beta vs the equal-weight universe so the tape can say
whether leadership is risk-on (high-beta cyclicals) or risk-off (defensives).

We compute on this universe. We do not ingest Caltropia's numbers.
Paper diagnostic — not a live book, not investment advice.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

LOOKBACK_CURRENT = 20   # ~1 month
LOOKBACK_MOM = 60       # ~1 quarter
LOOKBACK_BETA = 60
HEATMAP_WEEKS = 8
WEEK_BARS = 5
STRETCH_Z = 2.0
LEAD_BREADTH = 0.65
REPAIR_BREADTH = 0.50
IMPULSE_FLAT = 0.002    # 20 bp of weekly return change ≈ flat

DEFENSIVE = {
    "Health Care",
    "Consumer Staples",
    "Utilities",
    "Real Estate",
}
CYCLICAL = {
    "Technology",
    "Consumer Discretionary",
    "Financials",
    "Energy",
    "Materials",
    "Industrials",
    "Communication Services",
}


@dataclass
class GroupTape:
    group_type: str  # sector | industry
    name: str
    n_names: int
    tickers: list[str]
    current_breadth: float
    mom_breadth: float
    value_breadth: float | None
    lowvol_breadth: float
    avg_trend: float
    impulse: float
    beta_60: float | None
    rs_4w: float | None
    stretch_pct: float
    label: str
    heatmap: list[float]
    leaders: list[str]
    score: float
    bucket: str  # cyclical | defensive | mixed


def period_return(close: np.ndarray, days: int) -> float:
    if close.size < days + 1 or close[-1 - days] <= 0:
        return float("nan")
    return float(close[-1] / close[-1 - days] - 1.0)


def daily_returns(close: np.ndarray) -> np.ndarray:
    x = np.asarray(close, dtype=float)
    if x.size < 2:
        return np.array([], dtype=float)
    prev = x[:-1]
    with np.errstate(divide="ignore", invalid="ignore"):
        r = x[1:] / prev - 1.0
    r[~np.isfinite(r) | (prev <= 0)] = np.nan
    return r


def equal_weight_returns(closes: list[np.ndarray]) -> np.ndarray:
    usable = [np.asarray(c, dtype=float) for c in closes if len(c) >= 2]
    if not usable:
        return np.array([], dtype=float)
    n = min(len(c) for c in usable)
    rets = np.vstack([daily_returns(c[-n:]) for c in usable])
    return np.nanmean(rets, axis=0)


def ols_beta(y: np.ndarray, x: np.ndarray) -> float:
    """β from cov(y,x)/var(x) on overlapping finite observations."""
    y = np.asarray(y, dtype=float)
    x = np.asarray(x, dtype=float)
    n = min(y.size, x.size)
    if n < 10:
        return float("nan")
    y, x = y[-n:], x[-n:]
    mask = np.isfinite(y) & np.isfinite(x)
    if int(mask.sum()) < 10:
        return float("nan")
    yy, xx = y[mask], x[mask]
    var_x = float(np.var(xx, ddof=1))
    if var_x <= 0:
        return float("nan")
    cov = float(np.cov(yy, xx, ddof=1)[0, 1])
    return cov / var_x


def ret_z(close: np.ndarray, days: int = LOOKBACK_CURRENT) -> float:
    r = period_return(close, days)
    rets = daily_returns(close)
    if not math.isfinite(r) or rets.size < days:
        return float("nan")
    vol = float(np.nanstd(rets[-days:], ddof=0))
    if vol <= 0:
        return 0.0
    return r / (vol * math.sqrt(days))


def weekly_heatmap(close: np.ndarray, weeks: int = HEATMAP_WEEKS, bars: int = WEEK_BARS) -> list[float]:
    """Oldest → newest weekly returns. Pad with NaN when history is short."""
    need = weeks * bars + 1
    x = np.asarray(close, dtype=float)
    out: list[float] = []
    for w in range(weeks, 0, -1):
        end = x.size - (w - 1) * bars
        start = end - bars
        if start < 1 or end > x.size:
            out.append(float("nan"))
            continue
        a, b = x[start - 1], x[end - 1]
        out.append(float(b / a - 1.0) if a > 0 and math.isfinite(a) and math.isfinite(b) else float("nan"))
    if x.size < need:
        # keep computed tail; leading NaNs already filled
        pass
    return out


def trend_label(current_breadth: float, impulse: float) -> str:
    """Caltropia-style leadership bucket from breadth + weekly impulse."""
    if not math.isfinite(current_breadth):
        return "LAG"
    if current_breadth >= LEAD_BREADTH and impulse >= -IMPULSE_FLAT:
        return "LEAD"
    if current_breadth >= LEAD_BREADTH and impulse < -IMPULSE_FLAT:
        return "FADE"
    if current_breadth < REPAIR_BREADTH and impulse > IMPULSE_FLAT:
        return "REPAIR"
    if impulse > IMPULSE_FLAT:
        return "ACCEL"
    return "LAG"


def bucket_of(sector: str) -> str:
    if sector in DEFENSIVE:
        return "defensive"
    if sector in CYCLICAL:
        return "cyclical"
    return "mixed"


def rotation_regime(tapes: list[GroupTape]) -> str:
    """RISK-ON when cyclicals lead on 4w RS; RISK-OFF when defensives do."""
    cyc = [t for t in tapes if t.group_type == "sector" and t.bucket == "cyclical" and t.rs_4w is not None]
    deff = [t for t in tapes if t.group_type == "sector" and t.bucket == "defensive" and t.rs_4w is not None]
    if not cyc or not deff:
        return "MIXED"
    cyc_rs = float(np.mean([t.rs_4w for t in cyc]))  # type: ignore[arg-type]
    def_rs = float(np.mean([t.rs_4w for t in deff]))  # type: ignore[arg-type]
    spread = cyc_rs - def_rs
    if spread > 0.01:
        return "RISK-ON"
    if spread < -0.01:
        return "RISK-OFF"
    return "MIXED"


def _breadth(flags: list[bool]) -> float:
    if not flags:
        return float("nan")
    return sum(1 for f in flags if f) / len(flags)


def score_group(current_breadth: float, mom_breadth: float, rs_4w: float | None, impulse: float) -> float:
    rs = 0.0 if rs_4w is None or not math.isfinite(rs_4w) else float(np.clip(rs_4w / 0.05, -1.0, 1.0))
    imp = 0.0 if not math.isfinite(impulse) else float(np.clip(impulse / 0.02, -1.0, 1.0))
    cb = 0.0 if not math.isfinite(current_breadth) else current_breadth
    mb = 0.0 if not math.isfinite(mom_breadth) else mom_breadth
    return 40.0 * cb + 25.0 * mb + 20.0 * (rs + 1.0) / 2.0 + 15.0 * (imp + 1.0) / 2.0


def build_group_tape(
    *,
    group_type: str,
    name: str,
    sector_for_bucket: str,
    members: dict[str, np.ndarray],
    market_rets: np.ndarray,
    market_r4: float,
    vol_median: float,
    value_ok: dict[str, bool | None],
) -> GroupTape | None:
    if not members:
        return None
    tickers = sorted(members)
    closes = [members[t] for t in tickers]
    group_rets = equal_weight_returns(closes)
    beta = ols_beta(group_rets[-LOOKBACK_BETA:], market_rets[-LOOKBACK_BETA:]) if group_rets.size else float("nan")

    r20 = [period_return(c, LOOKBACK_CURRENT) for c in closes]
    r60 = [period_return(c, LOOKBACK_MOM) for c in closes]
    r5 = [period_return(c, WEEK_BARS) for c in closes]
    r5_prev = [period_return(c[:-WEEK_BARS] if c.size > WEEK_BARS else c, WEEK_BARS) for c in closes]
    z20 = [ret_z(c, LOOKBACK_CURRENT) for c in closes]
    vol20 = []
    for c in closes:
        d = daily_returns(c)
        vol20.append(float(np.nanstd(d[-LOOKBACK_CURRENT:], ddof=0)) if d.size >= LOOKBACK_CURRENT else float("nan"))

    finite20 = [x for x in r20 if math.isfinite(x)]
    current_breadth = _breadth([x > 0 for x in r20 if math.isfinite(x)])
    mom_breadth = _breadth([x > 0 for x in r60 if math.isfinite(x)])
    avg_trend = float(np.mean(finite20)) if finite20 else float("nan")
    impulse_vals = [
        a - b for a, b in zip(r5, r5_prev)
        if math.isfinite(a) and math.isfinite(b)
    ]
    impulse = float(np.mean(impulse_vals)) if impulse_vals else 0.0
    stretch_pct = _breadth([z > STRETCH_Z for z in z20 if math.isfinite(z)])
    lowvol_flags = [v < vol_median for v in vol20 if math.isfinite(v) and math.isfinite(vol_median)]
    lowvol_breadth = _breadth(lowvol_flags)

    value_flags = [value_ok[t] for t in tickers if value_ok.get(t) is not None]
    value_breadth = _breadth(value_flags) if value_flags else None

    group_r4 = float(np.mean(finite20)) if finite20 else float("nan")
    rs_4w = (group_r4 - market_r4) if math.isfinite(group_r4) and math.isfinite(market_r4) else None

    # Heatmap on equal-weight equity of the group
    if group_rets.size:
        eq = np.empty(group_rets.size + 1, dtype=float)
        eq[0] = 1.0
        eq[1:] = np.cumprod(1.0 + np.nan_to_num(group_rets, nan=0.0))
        heat = weekly_heatmap(eq)
    else:
        heat = [float("nan")] * HEATMAP_WEEKS

    ranked = sorted(
        ((t, r) for t, r in zip(tickers, r20) if math.isfinite(r)),
        key=lambda x: -x[1],
    )
    leaders = [t for t, _ in ranked[:3]]
    label = trend_label(current_breadth, impulse)
    score = score_group(current_breadth, mom_breadth, rs_4w, impulse)
    return GroupTape(
        group_type=group_type,
        name=name,
        n_names=len(tickers),
        tickers=tickers,
        current_breadth=current_breadth,
        mom_breadth=mom_breadth,
        value_breadth=value_breadth,
        lowvol_breadth=lowvol_breadth,
        avg_trend=avg_trend,
        impulse=impulse,
        beta_60=None if not math.isfinite(beta) else float(beta),
        rs_4w=rs_4w,
        stretch_pct=stretch_pct,
        label=label,
        heatmap=heat,
        leaders=leaders,
        score=score,
        bucket=bucket_of(sector_for_bucket),
    )
