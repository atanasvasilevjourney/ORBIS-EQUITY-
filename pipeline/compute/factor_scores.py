"""Systematic equity factor computation for trading.

Computes cross-sectional factor scores (0-100) from fundamentals_snapshot
and financial_reports, suitable for systematic equity strategies:

  VALUE       — cheap vs universe (P/E, P/B, EV/EBITDA, earnings yield, FCF yield)
  QUALITY     — profitability & F-Score (ROE, ROIC, margins, Piotroski)
  GROWTH      — revenue/EPS momentum (1y/3y growth rates)
  EARNINGS_Q  — accruals quality from financial reports (CFO vs net income)
  LEVERAGE    — balance-sheet strength (current ratio, D/E, interest coverage)
  COMPOSITE   — weighted blend for multi-factor screening

Also computes sector-relative percentile ranks for value and quality.

Usage:
    python -m pipeline.compute.factor_scores
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

import numpy as np
from dotenv import load_dotenv
from supabase import create_client

from pipeline.utils.supabase import fetch_all

load_dotenv()
logger = logging.getLogger(__name__)

# Composite weights (sum = 1.0) — systematic multi-factor tilt
WEIGHTS = {
    "value": 0.25,
    "quality": 0.25,
    "growth": 0.20,
    "earnings_quality": 0.15,
    "leverage": 0.15,
}


def _safe_div(a: float | None, b: float | None) -> float | None:
    if a is None or b is None or b == 0:
        return None
    return a / b


def _percentile_rank(values: np.ndarray) -> np.ndarray:
    """Map values to 0-100 percentile ranks (higher raw value = higher rank)."""
    n = len(values)
    if n == 0:
        return values
    order = values.argsort()
    ranks = np.empty(n, dtype=float)
    ranks[order] = np.arange(n, dtype=float)
  # handle ties with average rank
    result = np.zeros(n, dtype=float)
    for i in range(n):
        result[i] = ranks[i] / max(n - 1, 1) * 100
    return result


def _invert_percentile_rank(values: np.ndarray) -> np.ndarray:
    """For metrics where lower is better (P/E, P/B, debt)."""
    return 100.0 - _percentile_rank(values)


def _nan_to_median(arr: np.ndarray) -> np.ndarray:
    """Fill NaN with cross-sectional median for ranking."""
    med = np.nanmedian(arr)
    if np.isnan(med):
        med = 0.0
    out = arr.copy()
    out[np.isnan(out)] = med
    return out


def _compute_value_score(row: dict) -> float | None:
    """Cheapness composite from valuation ratios."""
    components = []
    pe = row.get("pe_ratio")
    if pe is not None and pe > 0:
        components.append(-pe)  # lower PE = higher score via rank
    pb = row.get("pb_ratio")
    if pb is not None and pb > 0:
        components.append(-pb)
    ev = row.get("ev_ebitda")
    if ev is not None and ev > 0:
        components.append(-ev)
    ey = row.get("earnings_yield")
    if ey is not None:
        components.append(ey)
    fy = row.get("fcf_yield")
    if fy is not None:
        components.append(fy)
    if not components:
        return None
    return float(np.mean(components))


def _compute_quality_score(row: dict) -> float | None:
    """Profitability and financial quality."""
    components = []
    for key in ("roe", "roic", "roa", "gross_margin", "operating_margin", "net_margin"):
        v = row.get(key)
        if v is not None:
            components.append(v)
    f = row.get("f_score")
    if f is not None:
        components.append(f / 9.0)  # normalize F-Score to 0-1
    if not components:
        return None
    return float(np.mean(components))


def _compute_growth_score(row: dict) -> float | None:
    """Revenue and earnings momentum."""
    components = []
    for key in ("revenue_growth_1y", "revenue_growth_3y", "eps_growth_1y", "net_income_growth_1y"):
        v = row.get(key)
        if v is not None:
            components.append(v)
    if not components:
        return None
    return float(np.mean(components))


def _compute_leverage_score(row: dict, interest_cov: float | None) -> float | None:
    """Balance sheet strength — higher is better."""
    components = []
    cr = row.get("current_ratio")
    if cr is not None:
        components.append(cr)
    de = row.get("debt_to_equity")
    if de is not None:
        components.append(-de)  # lower D/E = better
    if interest_cov is not None:
        components.append(min(interest_cov, 50.0))  # cap extreme values
    if not components:
        return None
    return float(np.mean(components))


def _fetch_financial_extras(sb) -> dict[str, dict]:
    """Per-symbol accruals ratio and interest coverage from latest FY reports."""
    extras: dict[str, dict] = {}

    for report_type, key in [("income", "income"), ("balance", "balance"), ("cashflow", "cashflow")]:
        rows = fetch_all(
            sb,
            "financial_reports",
            "symbol, date, data",
            filters=lambda q, rt=report_type: q.eq("report_type", rt).eq("period", "FY"),
            order=("date", True),
        )
        for r in rows:
            sym = r["symbol"]
            if sym not in extras:
                extras[sym] = {}
            if key not in extras[sym]:
                extras[sym][key] = r.get("data") or {}

    for sym, reports in extras.items():
        income = reports.get("income", {})
        balance = reports.get("balance", {})
        cashflow = reports.get("cashflow", {})

        ni = income.get("netIncome")
        cfo = cashflow.get("operatingCashFlow")
        ta = balance.get("totalAssets")
        if cfo is not None and ni is not None and ta and ta != 0:
            reports["accruals_ratio"] = (cfo - ni) / ta

        ebit = income.get("operatingIncome") or income.get("ebit")
        interest = income.get("interestExpense")
        if ebit is not None and interest is not None and interest != 0:
            reports["interest_coverage"] = ebit / abs(interest)

    return extras


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== Factor Scores Compute Start ===")

    sb_url = os.getenv("SUPABASE_URL", "")
    sb_key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not sb_url or not sb_key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
        return

    sb = create_client(sb_url, sb_key)

    # Load fundamentals + universe sector map
    fundamentals = fetch_all(sb, "fundamentals_snapshot", "*")
    universe = fetch_all(
        sb,
        "universe_members",
        "symbol, sector",
        filters=lambda q: q.eq("is_active", True),
    )
    sector_map = {r["symbol"]: r.get("sector") or "Unknown" for r in universe}

    if not fundamentals:
        logger.warning("No fundamentals data — run fundamentals ingest first")
        return

    logger.info("Computing factors for %d symbols", len(fundamentals))

    fin_extras = _fetch_financial_extras(sb)
    now = datetime.now(timezone.utc).isoformat()

    symbols = [r["symbol"] for r in fundamentals]
    n = len(symbols)

    # Raw factor signals for cross-sectional ranking
    raw_value = np.full(n, np.nan)
    raw_quality = np.full(n, np.nan)
    raw_growth = np.full(n, np.nan)
    raw_earn_q = np.full(n, np.nan)
    raw_leverage = np.full(n, np.nan)
    accruals = [None] * n
    interest_cov = [None] * n

    for i, row in enumerate(fundamentals):
        sym = row["symbol"]
        raw_value[i] = _compute_value_score(row) or np.nan
        raw_quality[i] = _compute_quality_score(row) or np.nan
        raw_growth[i] = _compute_growth_score(row) or np.nan

        extra = fin_extras.get(sym, {})
        ar = extra.get("accruals_ratio")
        ic = extra.get("interest_coverage")
        accruals[i] = ar
        interest_cov[i] = ic

        # Higher accruals ratio (more cash vs earnings) = better earnings quality
        if ar is not None:
            raw_earn_q[i] = ar
        elif row.get("net_income") and row["net_income"] > 0:
            raw_earn_q[i] = 0.0  # neutral if no report data

        lev = _compute_leverage_score(row, ic)
        if lev is not None:
            raw_leverage[i] = lev

    # Cross-sectional percentile ranks (0-100)
    value_scores = _percentile_rank(_nan_to_median(raw_value)).astype(int)
    quality_scores = _percentile_rank(_nan_to_median(raw_quality)).astype(int)
    growth_scores = _percentile_rank(_nan_to_median(raw_growth)).astype(int)
    earn_q_scores = _percentile_rank(_nan_to_median(raw_earn_q)).astype(int)
    leverage_scores = _percentile_rank(_nan_to_median(raw_leverage)).astype(int)

    # Sector-relative percentiles for value and quality
    sector_value_pctile = np.full(n, np.nan)
    sector_quality_pctile = np.full(n, np.nan)

    sectors = set(sector_map.get(s, "Unknown") for s in symbols)
    for sector in sectors:
        idx = [i for i, s in enumerate(symbols) if sector_map.get(s, "Unknown") == sector]
        if len(idx) < 3:
            continue
        idx_arr = np.array(idx)
        sector_value_pctile[idx_arr] = _percentile_rank(raw_value[idx_arr])
        sector_quality_pctile[idx_arr] = _percentile_rank(raw_quality[idx_arr])

    updates: list[dict] = []
    for i, sym in enumerate(symbols):
        composite = int(round(
            WEIGHTS["value"] * value_scores[i]
            + WEIGHTS["quality"] * quality_scores[i]
            + WEIGHTS["growth"] * growth_scores[i]
            + WEIGHTS["earnings_quality"] * earn_q_scores[i]
            + WEIGHTS["leverage"] * leverage_scores[i]
        ))

        updates.append({
            "symbol": sym,
            "value_score": int(value_scores[i]),
            "quality_score": int(quality_scores[i]),
            "growth_score": int(growth_scores[i]),
            "earnings_quality_score": int(earn_q_scores[i]),
            "leverage_score": int(leverage_scores[i]),
            "composite_factor_score": composite,
            "sector_value_pctile": round(float(sector_value_pctile[i]), 1) if not np.isnan(sector_value_pctile[i]) else None,
            "sector_quality_pctile": round(float(sector_quality_pctile[i]), 1) if not np.isnan(sector_quality_pctile[i]) else None,
            "accruals_ratio": round(accruals[i], 6) if accruals[i] is not None else None,
            "interest_coverage": round(interest_cov[i], 2) if interest_cov[i] is not None else None,
            "factor_computed_at": now,
        })

    # Batch upsert
    batch_size = 500
    for j in range(0, len(updates), batch_size):
        batch = updates[j : j + batch_size]
        try:
            sb.table("fundamentals_snapshot").upsert(batch, on_conflict="symbol").execute()
        except Exception:
            logger.exception("Failed to upsert factor batch %d-%d", j, j + len(batch))

    top = sorted(updates, key=lambda x: x["composite_factor_score"], reverse=True)[:5]
    logger.info(
        "=== Factor Scores Complete: %d symbols | Top composite: %s ===",
        len(updates),
        ", ".join(f"{t['symbol']}={t['composite_factor_score']}" for t in top),
    )


if __name__ == "__main__":
    main()
