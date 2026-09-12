"""Carver DCA rungs on the ROTATE nest — isolated from the PERPS book.

Maps HedgeFund_WiP + the Crypto Allocation notebook onto
Macro → Sector → Sub-sector → Asset:

  WHERE   already decided by canary-aligned sector tape
  WHICH   Carver Strategy 19-lite: 60d return vs the parent sleeve
  HOW MUCH  EWMAC forecast of the *bigger* trend, turned into discrete
            D1–D4 partials (DCA into strength, not into weakness)

A stronger parent forecast unlocks more rungs. Those rungs rotate into the
leading sub-sector and its top names. Losing sleeves stay FLAT so the same
risk budget can move.

Paper diagnostic. Not a live book. Not investment advice.
Do not mix this sleeve into PERPS / LOOP / ORB / BIAS.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from pipeline.compute.perps_math import (
    CARVER_IDM,
    CARVER_TARGET_VOL,
    blended_carver_forecast,
)
from pipeline.compute.sector_math import period_return

# Discrete DCA rungs on |bigger-trend forecast|. Forecast 10 = full Carver unit.
RUNG_EDGES = (5.0, 10.0, 15.0, 20.0)
MAX_RUNGS = len(RUNG_EDGES)
XS_LOOKBACK = 60
MAX_SLEEVES = 1
MAX_NAMES = 2
MAX_NAME_WEIGHT = 0.20
ROTATE_EQUITY = 100_000.0
VOL_FLOOR = 0.08


@dataclass(frozen=True)
class CarverDca:
    ticker: str
    sector: str
    industry: str
    forecast: float
    parent_forecast: float
    sleeve_forecast: float
    xs_score: float
    xs_rank: int
    sleeve_rank: int
    unlocked: int
    rungs: int
    weight: float
    notional: float
    side: str
    action: str
    aligned: bool


def rungs_from_forecast(forecast: float) -> int:
    """How many D-partials the bigger trend has unlocked (0–4)."""
    a = abs(float(forecast))
    if not math.isfinite(a):
        return 0
    return sum(1 for edge in RUNG_EDGES if a + 1e-12 >= edge)


def forecast_side(forecast: float, min_abs: float = RUNG_EDGES[0]) -> str:
    if not math.isfinite(forecast) or abs(forecast) < min_abs:
        return "FLAT"
    return "LONG" if forecast > 0 else "SHORT"


def name_agrees(name_forecast: float, parent_forecast: float) -> bool:
    ps = forecast_side(parent_forecast)
    ns = forecast_side(name_forecast, min_abs=0.0)
    if ps == "FLAT" or ns == "FLAT":
        return False
    return ps == ns


def xs_score(close: np.ndarray, peer_closes: list[np.ndarray], lookback: int = XS_LOOKBACK) -> float:
    """Strategy 19-lite: own 60d return minus equal-weight peer mean."""
    own = period_return(close, lookback)
    if not math.isfinite(own):
        return float("nan")
    peers = [period_return(c, lookback) for c in peer_closes]
    finite = [p for p in peers if math.isfinite(p)]
    if not finite:
        return float("nan")
    return float(own - float(np.mean(finite)))


def dca_action(unlocked: int, allocated: int, sleeve_rank: int, xs_rank: int) -> str:
    """ADD = DCA onto the bigger trend; ROTATE = rungs belong to a hotter sleeve."""
    if unlocked <= 0:
        return "FLAT"
    if allocated <= 0:
        return "ROTATE" if sleeve_rank > MAX_SLEEVES or xs_rank > MAX_NAMES else "FLAT"
    if allocated < unlocked:
        return "TRIM"
    if allocated >= 2 and sleeve_rank == 1 and xs_rank <= MAX_NAMES:
        return "ADD"
    return "HOLD"


def allocate_rungs(
    unlocked: int,
    *,
    aligned: bool,
    sleeve_rank: int,
    xs_rank: int,
    agrees: bool,
) -> int:
    if not aligned or unlocked <= 0 or not agrees:
        return 0
    if sleeve_rank > MAX_SLEEVES or xs_rank > MAX_NAMES:
        return 0
    return unlocked


def carver_weight(rungs: int, parent_forecast: float, inst_vol: float, dd_scalar: float = 1.0) -> float:
    """Vol-target weight × DCA fraction. Capped at 20% of the ROTATE sleeve."""
    if rungs <= 0 or inst_vol <= 0 or dd_scalar <= 0:
        return 0.0
    frac = rungs / float(MAX_RUNGS)
    vol = max(float(inst_vol), VOL_FLOOR)
    raw = (abs(parent_forecast) / 10.0) * CARVER_IDM * (CARVER_TARGET_VOL / vol) * frac * max(0.0, min(1.0, dd_scalar))
    return float(min(MAX_NAME_WEIGHT, max(0.0, raw)))


def annual_vol(close: np.ndarray, window: int = 20) -> float:
    if close.size < window + 1:
        return 0.0
    rets = np.diff(close.astype(float)) / close[:-1].astype(float)
    sigma = float(np.std(rets[-window:], ddof=0))
    if sigma <= 0 or math.isnan(sigma):
        return 0.0
    return sigma * math.sqrt(252.0)


@dataclass
class NameInput:
    ticker: str
    sector: str
    industry: str
    close: np.ndarray
    aligned: bool


def build_carver_book(
    names: list[NameInput],
    *,
    sector_closes: dict[str, np.ndarray],
    sleeve_closes: dict[str, np.ndarray],
    dd_scalar: float = 1.0,
    equity: float = ROTATE_EQUITY,
) -> list[CarverDca]:
    """Size discrete D-rungs on each name from the parent-sector trend + XS rank."""
    if not names:
        return []

    parent_fc: dict[str, float] = {}
    for sector, close in sector_closes.items():
        parent_fc[sector] = blended_carver_forecast(close)[0]

    sleeve_fc: dict[str, float] = {}
    for industry, close in sleeve_closes.items():
        sleeve_fc[industry] = blended_carver_forecast(close)[0]

    # Cross-section: rank sub-sectors inside each sector, names inside each sleeve
    by_sector: dict[str, list[NameInput]] = {}
    for n in names:
        by_sector.setdefault(n.sector, []).append(n)

    sleeve_rs: dict[str, float] = {}
    for industry, close in sleeve_closes.items():
        sleeve_rs[industry] = period_return(close, XS_LOOKBACK)

    sleeve_rank: dict[str, int] = {}
    for sector, members in by_sector.items():
        inds = sorted({m.industry for m in members})
        ranked = sorted(inds, key=lambda i: (-(sleeve_rs[i] if math.isfinite(sleeve_rs.get(i, float("nan"))) else -999), i))
        for i, industry in enumerate(ranked, start=1):
            sleeve_rank[industry] = i

    xs_scores: dict[str, float] = {}
    xs_rank: dict[str, int] = {}
    for sector, members in by_sector.items():
        by_ind: dict[str, list[NameInput]] = {}
        for m in members:
            by_ind.setdefault(m.industry, []).append(m)
        for industry, sleeve_names in by_ind.items():
            peers = [m.close for m in sleeve_names]
            scored: list[tuple[str, float]] = []
            for m in sleeve_names:
                sc = xs_score(m.close, peers)
                xs_scores[m.ticker] = sc
                scored.append((m.ticker, sc if math.isfinite(sc) else float("-inf")))
            scored.sort(key=lambda t: (-t[1], t[0]))
            for i, (ticker, _) in enumerate(scored, start=1):
                xs_rank[ticker] = i

    rows: list[CarverDca] = []
    for n in names:
        pfc = parent_fc.get(n.sector, 0.0)
        sfc = sleeve_fc.get(n.industry, 0.0)
        nfc = blended_carver_forecast(n.close)[0]
        unlocked = rungs_from_forecast(pfc) if n.aligned else 0
        sr = sleeve_rank.get(n.industry, 99)
        xr = xs_rank.get(n.ticker, 99)
        agrees = name_agrees(nfc, pfc)
        rungs = allocate_rungs(unlocked, aligned=n.aligned, sleeve_rank=sr, xs_rank=xr, agrees=agrees)
        vol = annual_vol(n.close)
        w = carver_weight(rungs, pfc, vol, dd_scalar=dd_scalar)
        side = forecast_side(pfc) if rungs > 0 else "FLAT"
        rows.append(CarverDca(
            ticker=n.ticker,
            sector=n.sector,
            industry=n.industry,
            forecast=float(nfc),
            parent_forecast=float(pfc),
            sleeve_forecast=float(sfc),
            xs_score=float(xs_scores.get(n.ticker, float("nan"))),
            xs_rank=xr,
            sleeve_rank=sr,
            unlocked=unlocked,
            rungs=rungs,
            weight=w,
            notional=w * equity * (1.0 if side != "SHORT" else -1.0),
            side=side,
            action=dca_action(unlocked, rungs, sr, xr),
            aligned=n.aligned,
        ))

    rows.sort(key=lambda r: (-r.rungs, r.sleeve_rank, r.xs_rank, r.ticker))
    return rows
