"""Macro canaries + TEMA-MACD ensemble.

Maps the ChatGPT Crypto Allocation notebook onto listed-equity baskets:

  Canary  ratio → rolling z-score → causal EMA smooth → vote +1/0/−1
  Regime  sum of votes → STRONG RISK-ON … STRONG RISK-OFF
  TEMA    Fast TEMA − Slow TEMA, EMA signal; hist>0 is a long vote
          Ensemble = share of a compact robust grid that is long.

Baskets are equal-weight sector proxies (no live QQQ/XLY/HYG tape here).
9/99/199 swing stays a separate column — not replaced by the grid.
Paper diagnostic. Not investment advice.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from pipeline.compute.perps_math import ema, tema, tema_signal, wilder_atr
from pipeline.compute.sector_math import equal_weight_returns

Z_WINDOW = 126
SMOOTH_SPAN = 10
VOTE_BAND = 0.25  # |smooth z| below this is 0
SMA_TREND = 200

# Compact robust area around the notebook's TEMA-MACD grid + 9/xx habit.
# Full 5–20 × 21–100 search is a research tool, not a nightly tape.
TEMA_MACD_GRID: tuple[tuple[int, int, int], ...] = (
    (8, 21, 9),
    (12, 26, 9),
    (9, 34, 9),
    (15, 40, 9),
    (8, 63, 9),
    (12, 50, 9),
)
ENSEMBLE_LONG = 0.55
ENSEMBLE_SHORT = 0.45


@dataclass(frozen=True)
class CanaryVote:
    name: str
    pair: str
    z: float | None
    smooth: float | None
    vote: int  # +1 / 0 / -1
    implication: str
    proxy: bool


@dataclass(frozen=True)
class CanaryRegime:
    regime: str
    score: int
    n_on: int
    n_off: int
    n_flat: int
    votes: list[CanaryVote]


@dataclass(frozen=True)
class TemaEnsemble:
    ticker: str
    ensemble: float
    n_long: int
    n_short: int
    n_cfg: int
    triggered: str  # LONG | SHORT | FLAT
    tema_side: str
    tema_grade: str
    macd_action: str


def equity_from_closes(closes: list[np.ndarray]) -> np.ndarray:
    rets = equal_weight_returns(closes)
    if rets.size == 0:
        return np.array([1.0])
    eq = np.empty(rets.size + 1, dtype=float)
    eq[0] = 1.0
    eq[1:] = np.cumprod(1.0 + np.nan_to_num(rets, nan=0.0))
    return eq


def rolling_z(series: np.ndarray, window: int = Z_WINDOW) -> np.ndarray:
    x = np.asarray(series, dtype=float)
    n = int(x.size)
    out = np.full(n, np.nan)
    if n < window:
        return out
    for i in range(window - 1, n):
        sl = x[i - window + 1 : i + 1]
        sl = sl[np.isfinite(sl)]
        if sl.size < max(20, window // 3):
            continue
        sd = float(np.std(sl, ddof=1))
        if sd <= 0:
            continue
        out[i] = (float(x[i]) - float(np.mean(sl))) / sd
    return out


def causal_smooth(z: np.ndarray, span: int = SMOOTH_SPAN) -> np.ndarray:
    """EMA of z, starting at the first finite print (causal)."""
    x = np.asarray(z, dtype=float)
    out = np.full(x.size, np.nan)
    finite = np.where(np.isfinite(x))[0]
    if finite.size == 0:
        return out
    start = int(finite[0])
    seeded = np.nan_to_num(x[start:], nan=0.0)
    # replace leading zeros that were nan with first finite
    seeded[0] = float(x[start])
    sm = ema(seeded, span)
    out[start:] = sm
    # restore nan where original z is nan after start
    out[start:][~np.isfinite(x[start:])] = np.nan
    return out


def vote_from_smooth(smooth: float, invert: bool = False) -> int:
    if not math.isfinite(smooth):
        return 0
    v = 1 if smooth > VOTE_BAND else (-1 if smooth < -VOTE_BAND else 0)
    return -v if invert else v


def ratio_canary(
    num: np.ndarray,
    den: np.ndarray,
    *,
    name: str,
    pair: str,
    invert: bool,
    implication_on: str,
    implication_off: str,
) -> CanaryVote:
    n = min(num.size, den.size)
    if n < Z_WINDOW + SMOOTH_SPAN:
        return CanaryVote(name, pair, None, None, 0, "insufficient history", True)
    a, b = num[-n:], den[-n:]
    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = a / b
    ratio[~np.isfinite(ratio) | (b <= 0)] = np.nan
    z = rolling_z(ratio)
    sm = causal_smooth(z)
    z_last = float(z[-1]) if math.isfinite(z[-1]) else float("nan")
    sm_last = float(sm[-1]) if math.isfinite(sm[-1]) else float("nan")
    vote = vote_from_smooth(sm_last, invert=invert)
    impl = implication_on if vote > 0 else (implication_off if vote < 0 else "flat")
    return CanaryVote(
        name=name,
        pair=pair,
        z=None if not math.isfinite(z_last) else z_last,
        smooth=None if not math.isfinite(sm_last) else sm_last,
        vote=vote,
        implication=impl,
        proxy=True,
    )


def trend_canary(eq: np.ndarray) -> CanaryVote:
    """Universe vs 200-SMA — the notebook's simplest canary."""
    if eq.size < SMA_TREND:
        return CanaryVote("SPY/200DMA", "UNIV vs SMA200", None, None, 0, "insufficient history", True)
    sma = float(np.mean(eq[-SMA_TREND:]))
    last = float(eq[-1])
    if sma <= 0 or not math.isfinite(sma) or not math.isfinite(last):
        return CanaryVote("SPY/200DMA", "UNIV vs SMA200", None, None, 0, "flat", True)
    z = (last / sma) - 1.0
    vote = 1 if last > sma else -1
    return CanaryVote(
        name="SPY/200DMA",
        pair="UNIV vs SMA200",
        z=z,
        smooth=z,
        vote=vote,
        implication="broad trend up" if vote > 0 else "broad trend down",
        proxy=True,
    )


def score_regime(votes: list[CanaryVote]) -> CanaryRegime:
    score = sum(v.vote for v in votes)
    n_on = sum(1 for v in votes if v.vote > 0)
    n_off = sum(1 for v in votes if v.vote < 0)
    n_flat = sum(1 for v in votes if v.vote == 0)
    if score >= 3:
        regime = "STRONG RISK-ON"
    elif score >= 1:
        regime = "RISK-ON"
    elif score <= -3:
        regime = "STRONG RISK-OFF"
    elif score <= -1:
        regime = "RISK-OFF"
    else:
        regime = "NEUTRAL"
    return CanaryRegime(regime, score, n_on, n_off, n_flat, votes)


def build_canaries(baskets: dict[str, np.ndarray]) -> CanaryRegime:
    """`baskets` keys: univ, tech, disc, staples, energy, defensive, financials."""
    univ = baskets.get("univ")
    votes: list[CanaryVote] = []
    if univ is None:
        return score_regime([])
    pairs = [
        ("tech", "QQQ/SPY", "TECH/UNIV", False, "growth / tech risk-on", "growth fading"),
        ("disc", "XLY/XLP", "DISC/STAPLES", False, "cyclical appetite", "defensive consumer"),
        ("energy", "XLE/SPY", "ENERGY/UNIV", False, "cyclical / energy lead", "energy lag"),
        ("defensive", "XLU/SPY", "DEFENSIVE/UNIV", True, "risk-on (defensives lag)", "defensive bid"),
        ("financials", "HYG/LQD", "FIN/STAPLES", False, "credit-appetite proxy", "credit-caution proxy"),
    ]
    den_overrides = {"XLY/XLP": "staples", "HYG/LQD": "staples"}
    for key, name, pair, invert, on, off in pairs:
        num = baskets.get(key)
        den_key = den_overrides.get(name, "univ")
        den = baskets.get(den_key)
        if num is None or den is None:
            continue
        # XLY/XLP needs both disc and staples
        if name == "XLY/XLP" and (baskets.get("disc") is None or baskets.get("staples") is None):
            continue
        votes.append(ratio_canary(num, den, name=name, pair=pair, invert=invert, implication_on=on, implication_off=off))
    votes.append(trend_canary(univ))
    return score_regime(votes)


def tema_macd_hist(close: np.ndarray, fast: int, slow: int, signal: int = 9) -> float:
    if close.size < slow + signal + 5:
        return float("nan")
    line = tema(close, fast) - tema(close, slow)
    sig = ema(line, signal)
    hist = line - sig
    return float(hist[-1])


def tema_ensemble(close: np.ndarray, high: np.ndarray | None = None, low: np.ndarray | None = None) -> TemaEnsemble:
    n_long = n_short = n_cfg = 0
    for fast, slow, sig in TEMA_MACD_GRID:
        h = tema_macd_hist(close, fast, slow, sig)
        if not math.isfinite(h):
            continue
        n_cfg += 1
        if h > 0:
            n_long += 1
        elif h < 0:
            n_short += 1
    ensemble = (n_long / n_cfg) if n_cfg else float("nan")
    if n_cfg and ensemble >= ENSEMBLE_LONG:
        triggered = "LONG"
    elif n_cfg and ensemble <= ENSEMBLE_SHORT:
        triggered = "SHORT"
    else:
        triggered = "FLAT"
    atr = 0.0
    if high is not None and low is not None:
        atr = wilder_atr(high, low, close)
    ts = tema_signal(close, high if high is not None else close, low if low is not None else close, atr) if atr > 0 else None
    return TemaEnsemble(
        ticker="",
        ensemble=ensemble,
        n_long=n_long,
        n_short=n_short,
        n_cfg=n_cfg,
        triggered=triggered,
        tema_side=ts.side if ts else "FLAT",
        tema_grade=ts.grade if ts else "REJECT",
        macd_action=ts.macd_action if ts else "HOLD",
    )


def group_aligned(bucket: str, label: str, canary_regime: str) -> bool:
    trending = label in {"LEAD", "ACCEL"}
    if canary_regime in {"RISK-ON", "STRONG RISK-ON"}:
        return trending and bucket == "cyclical"
    if canary_regime in {"RISK-OFF", "STRONG RISK-OFF"}:
        return trending and bucket == "defensive"
    return trending
