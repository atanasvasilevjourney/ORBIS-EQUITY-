"""TEMA + Carver math for the leveraged equity-perp paper desk.

QMIE (atanasvasilevjourney/QMIE) does not ship strategies named TEMA or
Carver. This module is the KovaView mapping:

  TEMA    Triple EMA swing stack (9/99/199) — 9 is the trigger,
          99 the swing, 199 the regime. 2.5 ATR stop / 4 ATR target.
  Carver  EWMAC 16/64 + 32/128, vol-target, drawdown scalar, and
          LIVE / REDUCE / CASH rotation from forecast breadth.

Signals run on listed-equity daily bars. Sizing is as a USDT-M perpetual:
leverage, isolated margin, liquidation. No live exchange orders.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

# ── TEMA swing (9 / 99 / 199) ───────────────────────────────────────────
# Daily: 9 ≈ 2 weeks, 99 ≈ 5 months, 199 ≈ 10 months. Feasible as a
# systematic swing if you have ≥ ~220 EOD bars (TEMA-199 is only fully
# settled after ~400). Full 9>99>199 stacks are uncommon — that is the
# point of a swing book, not a bug.
TEMA_FAST = 9
TEMA_MID = 99
TEMA_SLOW = 199
TEMA_SL_ATR = 2.5
TEMA_TP_ATR = 4.0
TEMA_MIN_GRADE = "B"
TEMA_TOP_LONG = 3
TEMA_TOP_SHORT = 3
TEMA_CLUSTER_MAX = 2
TEMA_RISK_PCT = 0.02  # of allocated slot capital at the 2.5 ATR stop
TEMA_WARMUP_FULL = 400

# ── Carver ──────────────────────────────────────────────────────────────
EWMAC_FAST_PAIR = (16, 64, 3.75)   # Lfast, Lslow, forecast scalar
EWMAC_SLOW_PAIR = (32, 128, 2.65)
CARVER_CAP = 20.0
CARVER_MIN_ABS = 5.0              # skip noise-scale forecasts
CARVER_VOL_WINDOW = 20
CARVER_PRICE_SIGMA_WINDOW = 25
CARVER_TARGET_VOL = 0.25          # levered CTA sleeve
CARVER_IDM = 1.2
CARVER_GROSS_LEV_CAP = 3.0
CARVER_DD_SOFT = 0.10             # start tapering risk
CARVER_DD_HARD = 0.25             # CASH (Carver-style max-DD overlay)
CARVER_LIVE_MIN = 3               # forecasts |f|>=min to stay LIVE
CARVER_REDUCE_TOP = 2             # names kept in REDUCE rotation

# ── Shared perp overlay ─────────────────────────────────────────────────
MAX_LEVERAGE = 5.0
MAINT_MARGIN = 0.005              # 0.5% isolated MMR (typical liquid linear)
MIN_ATR_PCT = 0.10                # QMIE SIG_MIN_ATR_PCT
MAX_ATR_PCT = 8.0                 # QMIE SIG_MAX_ATR_PCT
FUNDING_SKIP = 0.001              # QMIE SIG_FUNDING_RATE_THRESHOLD (0.1%/8h)
EQUITY = 100_000.0
TEMA_SLEEVE_FRAC = 0.50
CARVER_SLEEVE_FRAC = 0.50
MIN_BARS = 220  # TEMA 199 + a short EMA settle

_GRADE_RANK = {"A+": 4, "A": 3, "B": 2, "C": 1, "REJECT": 0, "NEUTRAL": 0}


def ema(series: np.ndarray, span: int) -> np.ndarray:
    """EMA with alpha = 2/(span+1), seeded at the first print."""
    n = len(series)
    out = np.empty(n, dtype=float)
    if n == 0:
        return out
    alpha = 2.0 / (span + 1.0)
    out[0] = float(series[0])
    for i in range(1, n):
        out[i] = alpha * float(series[i]) + (1.0 - alpha) * out[i - 1]
    return out


def tema(series: np.ndarray, span: int) -> np.ndarray:
    """Triple EMA: 3·EMA − 3·EMA(EMA) + EMA(EMA(EMA))."""
    e1 = ema(series, span)
    e2 = ema(e1, span)
    e3 = ema(e2, span)
    return 3.0 * e1 - 3.0 * e2 + e3


def wilder_atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> float:
    if len(close) < 2:
        return 0.0
    prev = close[:-1]
    h, l = high[1:], low[1:]
    tr = np.maximum(h - l, np.maximum(np.abs(h - prev), np.abs(l - prev)))
    if len(tr) < period:
        return float(np.mean(tr)) if len(tr) else 0.0
    atr = float(np.mean(tr[:period]))
    for x in tr[period:]:
        atr = (atr * (period - 1) + float(x)) / period
    return float(atr)


def annual_vol(close: np.ndarray, window: int = CARVER_VOL_WINDOW) -> float:
    if len(close) < window + 1:
        return 0.0
    rets = np.diff(close.astype(float)) / close[:-1].astype(float)
    sigma = float(np.std(rets[-window:], ddof=0))
    if sigma <= 0 or math.isnan(sigma):
        return 0.0
    return sigma * math.sqrt(252.0)


def ewmac_forecast(close: np.ndarray, fast: int, slow: int, scalar: float) -> float:
    """Carver EWMAC: (EMA_fast − EMA_slow) / σ_price × scalar, clip ±20.

    σ_price is the 25-day stdev of *price changes* (not returns), matching
    *Systematic Trading* / pysystemtrade.
    """
    if len(close) < slow + CARVER_PRICE_SIGMA_WINDOW:
        return 0.0
    diff = ema(close, fast)[-1] - ema(close, slow)[-1]
    changes = np.diff(close.astype(float))
    sigma = float(np.std(changes[-CARVER_PRICE_SIGMA_WINDOW:], ddof=0))
    if sigma <= 0 or math.isnan(sigma):
        return 0.0
    return float(np.clip((diff / sigma) * scalar, -CARVER_CAP, CARVER_CAP))


def blended_carver_forecast(close: np.ndarray) -> tuple[float, float, float]:
    f_fast = ewmac_forecast(close, *EWMAC_FAST_PAIR)
    f_slow = ewmac_forecast(close, *EWMAC_SLOW_PAIR)
    blended = 0.5 * (f_fast + f_slow)
    blended = float(np.clip(blended, -CARVER_CAP, CARVER_CAP))
    return blended, f_fast, f_slow


def grade_for(score: float, side: str) -> str:
    if side in ("FLAT", "NEUTRAL", ""):
        return "REJECT"
    if score >= 90:
        return "A+"
    if score >= 80:
        return "A"
    if score >= 65:
        return "B"
    if score >= 50:
        return "C"
    return "REJECT"


def grade_ok(grade: str, min_grade: str = TEMA_MIN_GRADE) -> bool:
    return _GRADE_RANK.get(grade, 0) >= _GRADE_RANK.get(min_grade, 3)


@dataclass
class TemaSignal:
    side: str  # BUY / SELL / FLAT
    grade: str
    score: float
    t_fast: float
    t_mid: float
    t_slow: float
    strength: float
    stop: float
    take_profit: float
    warmup: str  # full | partial


def tema_signal(close: np.ndarray, high: np.ndarray, low: np.ndarray, atr: float) -> TemaSignal | None:
    if len(close) < MIN_BARS or atr <= 0:
        return None
    t_fast = float(tema(close, TEMA_FAST)[-1])
    t_mid = float(tema(close, TEMA_MID)[-1])
    t_slow = float(tema(close, TEMA_SLOW)[-1])
    last = float(close[-1])
    atr_pct = (atr / last) * 100.0
    vol_bonus = 5.0 if MIN_ATR_PCT <= atr_pct <= MAX_ATR_PCT else 0.0
    warmup = "full" if len(close) >= TEMA_WARMUP_FULL else "partial"

    # Swing rule (not a 3-line ribbon stack). TEMA overshoots, so requiring
    # 9>99>199 inverts on sharp dumps. Use 199 as regime and 9 vs 99 as trigger.
    regime_up = last > t_slow
    regime_dn = last < t_slow
    trigger_up = t_fast > t_mid
    trigger_dn = t_fast < t_mid
    fan = abs(t_fast - t_mid) / atr
    if regime_up and trigger_up:
        side = "BUY"
        strength = float(fan)
    elif regime_dn and trigger_dn:
        side = "SELL"
        strength = float(fan)
    else:
        side = "FLAT"
        strength = 0.0

    strength = max(0.0, strength)
    score = 0.0 if side == "FLAT" else min(100.0, 60.0 + min(35.0, strength * 8.0) + vol_bonus)
    grade = grade_for(score, side)
    if side == "BUY":
        stop = last - TEMA_SL_ATR * atr
        tp = last + TEMA_TP_ATR * atr
    elif side == "SELL":
        stop = last + TEMA_SL_ATR * atr
        tp = last - TEMA_TP_ATR * atr
    else:
        stop = tp = last
    return TemaSignal(
        side=side, grade=grade, score=round(score, 1),
        t_fast=t_fast, t_mid=t_mid, t_slow=t_slow, strength=round(strength, 3),
        stop=stop, take_profit=tp, warmup=warmup,
    )


@dataclass
class PerpSize:
    notional: float
    leverage: float
    margin: float
    liq: float | None
    capped: bool


def liquidation_price(entry: float, side: str, leverage: float, mmr: float = MAINT_MARGIN) -> float | None:
    """Isolated USDT-M approximation. Not exchange-exact (tiers, fees, funding).

    Leverage ≤ 1 is fully funded cash-like: no liquidation engine.
    """
    if entry <= 0 or leverage <= 1.0:
        return None
    if side in ("BUY", "LONG"):
        return entry * (1.0 - 1.0 / leverage + mmr)
    if side in ("SELL", "SHORT"):
        return entry * (1.0 + 1.0 / leverage - mmr)
    return None


def size_perp(notional: float, allocated: float, entry: float, side: str,
              max_lev: float = MAX_LEVERAGE) -> PerpSize:
    """Map a signed cash notional onto an isolated perp: leverage, margin, liq.

    Natural leverage = |notional| / allocated. Capped at max_lev by shrinking
    the contract. Sub-1x stays fully funded (leverage 1).
    """
    if allocated <= 0 or entry <= 0 or notional == 0 or side in ("FLAT", "NEUTRAL", ""):
        return PerpSize(0.0, 0.0, 0.0, None, False)
    signed = float(notional)
    abs_n = abs(signed)
    natural = abs_n / allocated
    capped = False
    if natural <= 1.0:
        lev = 1.0
        margin = abs_n
    else:
        lev = min(max_lev, natural)
        if natural > max_lev:
            abs_n = allocated * max_lev
            signed = math.copysign(abs_n, signed)
            capped = True
        lev = abs_n / allocated
        margin = allocated
    liq = liquidation_price(entry, side, lev)
    return PerpSize(notional=signed, leverage=round(lev, 2), margin=margin, liq=liq, capped=capped)


def tema_notional(allocated: float, price: float, atr: float) -> float:
    """Notional so that a TEMA_SL_ATR stop loses TEMA_RISK_PCT of allocated capital."""
    stop_dist = TEMA_SL_ATR * atr
    if stop_dist <= 0 or price <= 0 or allocated <= 0:
        return 0.0
    return allocated * TEMA_RISK_PCT * (price / stop_dist)


def carver_notional(forecast: float, sleeve_equity: float, inst_vol: float,
                    dd_scalar: float = 1.0) -> float:
    if inst_vol <= 0 or sleeve_equity <= 0 or abs(forecast) < CARVER_MIN_ABS:
        return 0.0
    if dd_scalar <= 0:
        return 0.0
    weight = (forecast / 10.0) * CARVER_IDM * (CARVER_TARGET_VOL / inst_vol)
    return weight * sleeve_equity * max(0.0, min(1.0, dd_scalar))


def peak_drawdown_current(equity: np.ndarray) -> tuple[float, float]:
    """Return (current DD from peak, max DD), both ≤ 0."""
    if len(equity) < 2:
        return 0.0, 0.0
    peak = np.maximum.accumulate(equity)
    dd = equity / np.where(peak > 0, peak, 1.0) - 1.0
    return float(dd[-1]), float(np.min(dd))


def equal_weight_equity(closes: list[np.ndarray]) -> np.ndarray:
    """Align series from the end and compound equal-weight daily returns."""
    usable = [c.astype(float) for c in closes if len(c) >= 21]
    if not usable:
        return np.array([1.0])
    n = min(len(c) for c in usable)
    rets = np.vstack([(c[-n:][1:] / c[-n:][:-1]) - 1.0 for c in usable])
    mean_r = np.mean(rets, axis=0)
    eq = np.empty(n, dtype=float)
    eq[0] = 1.0
    eq[1:] = np.cumprod(1.0 + mean_r)
    return eq


def drawdown_scalar(current_dd: float, soft: float = CARVER_DD_SOFT,
                    hard: float = CARVER_DD_HARD) -> float:
    """Carver risk overlay: 1.0 until |DD|=soft, 0.0 at |DD|≥hard, linear between.

    `current_dd` is signed (e.g. -0.12). Recovered books return to 1.0.
    """
    if hard <= soft:
        return 1.0
    depth = abs(min(0.0, current_dd))
    if depth <= soft:
        return 1.0
    if depth >= hard:
        return 0.0
    return float(1.0 - (depth - soft) / (hard - soft))


def rotation_regime(dd_scalar: float, n_active: int, live_min: int = CARVER_LIVE_MIN) -> str:
    """LIVE / REDUCE / CASH from drawdown scalar and forecast breadth."""
    if dd_scalar <= 0.0 or n_active <= 0:
        return "CASH"
    if dd_scalar < 0.7 or n_active < live_min:
        return "REDUCE"
    return "LIVE"


def rotation_size_mult(regime: str) -> float:
    if regime == "CASH":
        return 0.0
    if regime == "REDUCE":
        return 0.5
    return 1.0


def scale_gross(notionals: list[float], sleeve_equity: float, cap: float) -> list[float]:
    """Shrink a book so sum(|notional|) / equity ≤ cap."""
    if sleeve_equity <= 0 or cap <= 0:
        return [0.0] * len(notionals)
    gross = sum(abs(x) for x in notionals)
    if gross <= 0:
        return list(notionals)
    limit = cap * sleeve_equity
    if gross <= limit:
        return list(notionals)
    k = limit / gross
    return [x * k for x in notionals]


def side_weights(n: int, book_pct: float, weighting: str = "rank") -> list[float]:
    if n <= 0:
        return []
    if weighting == "equal":
        raw = [book_pct / n] * n
    else:
        seq = [float(n - i) for i in range(n)]
        total = sum(seq)
        raw = [book_pct * x / total for x in seq]
    rounded = [round(x, 2) for x in raw]
    rounded[0] = round(book_pct - sum(rounded[1:]), 2)
    return rounded


def pick_ranked(cands: list, n: int, cluster_max: int, cluster_of) -> list:
    picked = []
    counts: dict[str, int] = {}
    for r in cands:
        if len(picked) >= n:
            break
        c = cluster_of(r)
        if cluster_max > 0 and counts.get(c, 0) >= cluster_max:
            continue
        picked.append(r)
        counts[c] = counts.get(c, 0) + 1
    return picked


def funding_blocks(side: str, funding_8h: float | None, threshold: float = FUNDING_SKIP) -> bool:
    """QMIE: suppress BUY when funding > +th, SELL when funding < −th."""
    if funding_8h is None:
        return False
    if side == "BUY" and funding_8h > threshold:
        return True
    if side == "SELL" and funding_8h < -threshold:
        return True
    return False


def funding_ann(funding_8h: float | None) -> float | None:
    if funding_8h is None:
        return None
    return float(funding_8h) * 3.0 * 365.0


def perp_contract(ticker: str) -> str:
    return f"{ticker.upper().replace('.', '')}USDT"


def round_px(v: float) -> float:
    av = abs(v)
    if av >= 1000:
        return round(v, 1)
    if av >= 100:
        return round(v, 2)
    if av >= 10:
        return round(v, 2)
    return round(v, 4)
