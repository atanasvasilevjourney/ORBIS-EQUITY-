"""Quantropy desk — risk, CAPM, Altman Z, Markowitz allocation.

Port of https://github.com/atanasvasilevjourney/Quantropy (Matilda) onto
KovaView `prices_daily` + `fundamentals_snapshot`. No broker, no Ken-French
file drop, no Flask. Paper analytics only.

  Risk      vol, Sharpe, Sortino, max DD, historical VaR/CVaR (Quantropy
            `risk_quantification.py`, corrected CVaR tail)
  CAPM      alpha/beta vs equal-weight universe (lite FactorModels.CAPM)
  Distress  public-firm Altman Z from snapshot ratios (Quantropy
            `financial_distress_models.altman_z_score`)
  Alloc     equal, inverse-vol, min-variance, max-Sharpe, efficient frontier
            (Quantropy `ModernPortfolioTheory`, long-only, weights sum to 1)

Usage:
    python -m pipeline.compute.quantropy
"""
from __future__ import annotations

import logging
import os
from collections import defaultdict
from datetime import date, datetime, timezone

import numpy as np
from dotenv import load_dotenv
from scipy.optimize import Bounds, minimize

from pipeline.utils.supabase import fetch_all

load_dotenv()
load_dotenv(".env.local")
logger = logging.getLogger(__name__)

PERIOD = 252
RF_ANNUAL = 0.04  # Quantropy used Ken French RF; we use a 4% cash proxy
RF_DAILY = RF_ANNUAL / PERIOD
VAR_Q = 0.05
MIN_OBS = 60
FRONTIER_N = 24


def _sb():
    from pipeline.utils.client import get_supabase
    return get_supabase()



def max_drawdown(returns: np.ndarray) -> float:
    """Peak-to-trough on a wealth index (Quantropy drawdown_risk, no plot)."""
    if len(returns) == 0:
        return 0.0
    wealth = np.cumprod(1.0 + returns)
    peak = np.maximum.accumulate(wealth)
    dd = wealth / np.maximum(peak, 1e-12) - 1.0
    return float(dd.min())


def historical_var(returns: np.ndarray, q: float = VAR_Q) -> float:
    """Positive loss number at quantile q (Quantropy historical simulation)."""
    if len(returns) == 0:
        return 0.0
    return float(-np.quantile(returns, q))


def historical_cvar(returns: np.ndarray, q: float = VAR_Q) -> float:
    """Expected shortfall of the left tail — mean of returns ≤ VaR quantile."""
    if len(returns) == 0:
        return 0.0
    cutoff = np.quantile(returns, q)
    tail = returns[returns <= cutoff]
    if len(tail) == 0:
        return historical_var(returns, q)
    return float(-tail.mean())


def capm_alpha_beta(r: np.ndarray, mkt: np.ndarray) -> tuple[float, float]:
    """OLS r = alpha + beta * mkt. Alpha annualized."""
    if len(r) < 20:
        return 0.0, 1.0
    x = np.column_stack([np.ones(len(mkt)), mkt])
    coef, _, _, _ = np.linalg.lstsq(x, r, rcond=None)
    return float(coef[0] * PERIOD), float(coef[1])


def altman_z(fund: dict) -> tuple[float | None, str | None]:
    """Public-firm Altman Z from snapshot fields.

    TA inferred from NI / ROA. Zones match Quantropy's manufacturing table:
    safe > 2.99, distress < 1.81, else grey.
    """
    ni = fund.get("net_income")
    roa = fund.get("roa")
    op = fund.get("operating_income")
    rev = fund.get("revenue")
    mcap = fund.get("market_cap")
    da = fund.get("debt_to_assets")
    cr = fund.get("current_ratio")
    if not ni or not roa or abs(roa) < 1e-8:
        return None, None
    ta = float(ni) / float(roa)
    if ta <= 0:
        return None, None
    # WC/TA: current assets ≈ CR/(CR+1)*TA if CL ≈ TA/(CR+1)
    a = 0.0
    if cr and cr > 0:
        cl = ta / (float(cr) + 1.0)
        ca = float(cr) * cl
        a = (ca - cl) / ta
    b = float(roa)  # RE/TA unavailable; ROA is the retained-profitability proxy
    c = (float(op) / ta) if op else float(roa)
    tl = (float(da) * ta) if da is not None else None
    if tl and tl > 0 and mcap:
        d = float(mcap) / tl
    else:
        d = 1.0 / max(float(da or 0.5), 0.05)
    e = (float(rev) / ta) if rev else 0.0
    z = 1.2 * a + 1.4 * b + 3.3 * c + 0.6 * d + 1.0 * e
    if z > 2.99:
        zone = "safe"
    elif z < 1.81:
        zone = "distress"
    else:
        zone = "grey"
    return float(z), zone


def _portfolio_stats(weights: np.ndarray, mu: np.ndarray, cov: np.ndarray) -> dict:
    ret = float(weights @ mu)
    vol = float(np.sqrt(weights @ cov @ weights))
    sharpe = (ret - RF_ANNUAL) / vol if vol > 1e-12 else 0.0
    return {"annReturn": ret, "annVol": vol, "sharpe": sharpe}


def _optimize(mu: np.ndarray, cov: np.ndarray, target: str, target_return: float | None = None) -> np.ndarray | None:
    n = len(mu)
    w0 = np.ones(n) / n

    def vol(w):
        return np.sqrt(w @ cov @ w)

    def neg_sharpe(w):
        v = vol(w)
        if v < 1e-12:
            return 0.0
        return -((w @ mu) - RF_ANNUAL) / v

    cons = [{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}]
    if target_return is not None:
        cons.append({"type": "eq", "fun": lambda w, t=target_return: w @ mu - t})
    fun = neg_sharpe if target == "sharpe" else vol
    res = minimize(fun, w0, method="SLSQP", bounds=Bounds(0, 1), constraints=cons, options={"maxiter": 400})
    if not res.success:
        return None
    w = np.clip(res.x, 0, 1)
    s = w.sum()
    return w / s if s > 0 else None


def _align_returns(by_sym: dict[str, list[tuple[str, float]]]) -> tuple[list[str], np.ndarray]:
    """Inner-join daily close series → return matrix (T × N)."""
    dates_sets = []
    closes: dict[str, dict[str, float]] = {}
    for sym, pts in by_sym.items():
        pts = sorted(pts)
        if len(pts) < MIN_OBS + 1:
            continue
        closes[sym] = {d: c for d, c in pts}
        dates_sets.append(set(closes[sym]))
    if len(closes) < 2:
        return [], np.empty((0, 0))
    common = sorted(set.intersection(*dates_sets))
    if len(common) < MIN_OBS + 1:
        return [], np.empty((0, 0))
    syms = sorted(closes)
    px = np.array([[closes[s][d] for s in syms] for d in common], dtype=float)
    rets = np.diff(px, axis=0) / px[:-1]
    rets = np.where(np.isfinite(rets), rets, 0.0)
    return syms, rets


def run() -> dict:
    today = date.today()
    run_id = f"q-{today.isoformat()}-{datetime.now(timezone.utc).strftime('%H%M%S')}"
    sb = _sb()
    logger.info("=== Quantropy desk start ===")

    uni = fetch_all(sb, "universe_members", "symbol, company_name",
                    filters=lambda q: q.eq("is_active", True))
    names = {r["symbol"]: r.get("company_name") or "" for r in uni if r.get("symbol")}
    funds = {r["symbol"]: r for r in fetch_all(sb, "fundamentals_snapshot", "*") if r.get("symbol")}
    prices = fetch_all(sb, "prices_daily", "symbol, date, close", order=("date", False))
    by_sym: dict[str, list[tuple[str, float]]] = defaultdict(list)
    last_px: dict[str, float] = {}
    for p in prices:
        if p.get("close") is None or not p.get("symbol"):
            continue
        by_sym[p["symbol"]].append((p["date"], float(p["close"])))
        last_px[p["symbol"]] = float(p["close"])

    symbols, rets = _align_returns(by_sym)
    if len(symbols) < 2:
        raise RuntimeError("Need ≥2 names with overlapping daily history for Quantropy")

    mkt = rets.mean(axis=1)
    mu = rets.mean(axis=0) * PERIOD
    vol = rets.std(axis=0, ddof=1) * np.sqrt(PERIOD)
    cov = np.cov(rets, rowvar=False) * PERIOD

    w_eq = np.ones(len(symbols)) / len(symbols)
    inv = 1.0 / np.maximum(vol, 1e-8)
    w_iv = inv / inv.sum()
    w_mv = _optimize(mu, cov, "vol")
    if w_mv is None:
        w_mv = w_eq
    w_ms = _optimize(mu, cov, "sharpe")
    if w_ms is None:
        w_ms = w_eq

    lo, hi = float(mu.min()), float(mu.max())
    frontier = []
    if hi > lo:
        for target in np.linspace(lo, hi, FRONTIER_N):
            w = _optimize(mu, cov, "vol", target_return=float(target))
            if w is None:
                continue
            st = _portfolio_stats(w, mu, cov)
            frontier.append({"annReturn": round(st["annReturn"], 6), "annVol": round(st["annVol"], 6),
                             "sharpe": round(st["sharpe"], 4)})

    books = {
        "equal": {**_portfolio_stats(w_eq, mu, cov), "label": "Equally weighted"},
        "invVol": {**_portfolio_stats(w_iv, mu, cov), "label": "Inverse volatility"},
        "minVar": {**_portfolio_stats(w_mv, mu, cov), "label": "Min variance (MPT)"},
        "maxSharpe": {**_portfolio_stats(w_ms, mu, cov), "label": "Max Sharpe (MPT)"},
    }
    for k, b in books.items():
        b["annReturn"] = round(b["annReturn"], 6)
        b["annVol"] = round(b["annVol"], 6)
        b["sharpe"] = round(b["sharpe"], 4)

    rows = []
    for i, sym in enumerate(symbols):
        r = rets[:, i]
        down = r[r < 0]
        dvol = (down.std(ddof=1) * np.sqrt(PERIOD)) if len(down) > 2 else float(vol[i])
        ann_ret = float(mu[i])
        ann_vol = float(vol[i])
        sharpe = (ann_ret - RF_ANNUAL) / ann_vol if ann_vol > 1e-12 else 0.0
        sortino = (ann_ret - RF_ANNUAL) / dvol if dvol > 1e-12 else 0.0
        alpha, beta = capm_alpha_beta(r, mkt)
        active = r - mkt
        te = active.std(ddof=1) * np.sqrt(PERIOD)
        ir = (active.mean() * PERIOD) / te if te > 1e-12 else 0.0
        z, zone = altman_z(funds.get(sym) or {})
        rows.append({
            "symbol": sym,
            "run_id": run_id,
            "company_name": names.get(sym) or None,
            "last_px": last_px.get(sym),
            "ann_return": round(ann_ret, 6),
            "ann_vol": round(ann_vol, 6),
            "downside_vol": round(float(dvol), 6),
            "sharpe": round(sharpe, 4),
            "sortino": round(sortino, 4),
            "max_drawdown": round(max_drawdown(r), 6),
            "var_95": round(historical_var(r), 6),
            "cvar_95": round(historical_cvar(r), 6),
            "beta": round(beta, 4),
            "alpha": round(alpha, 6),
            "info_ratio": round(ir, 4),
            "altman_z": None if z is None else round(z, 4),
            "altman_zone": zone,
            "w_equal": round(float(w_eq[i]), 6),
            "w_inv_vol": round(float(w_iv[i]), 6),
            "w_min_var": round(float(w_mv[i]), 6),
            "w_max_sharpe": round(float(w_ms[i]), 6),
            "computed_at": datetime.now(timezone.utc).isoformat(),
        })

    distressed = sum(1 for r in rows if r["altman_zone"] == "distress")
    headline = (
        f"{today.isoformat()} · {len(rows)} names · "
        f"max-Sharpe {books['maxSharpe']['sharpe']:.2f} · "
        f"min-vol {books['minVar']['annVol']*100:.1f}% · "
        f"{distressed} distress Z"
    )
    sb.table("quantropy_runs").upsert({
        "run_id": run_id,
        "asof_date": today.isoformat(),
        "names": len(rows),
        "headline": headline,
        "allocations": books,
        "frontier": frontier,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }).execute()

    existing = fetch_all(sb, "quantropy_names", "symbol")
    keep = {r["symbol"] for r in rows}
    stale = [r["symbol"] for r in existing if r.get("symbol") not in keep]
    if rows:
        sb.table("quantropy_names").upsert(rows).execute()
    if stale:
        sb.table("quantropy_names").delete().in_("symbol", stale).execute()

    logger.info("Quantropy wrote %d names · %s", len(rows), headline)
    return {"run_id": run_id, "names": len(rows), "headline": headline, "books": books}


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    print(run()["headline"])


if __name__ == "__main__":
    main()
