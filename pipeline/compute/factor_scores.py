"""Systematic equity factor computation for trading.

Each raw input is percentile-ranked on its own, inside the set of names that
actually have that input. Ties share an average rank. Missing inputs stay
missing: they are left out of the name's average and out of the peer set.
A style score is the equal-weight mean of its available input ranks.
The composite renormalizes the style weights over the styles that exist.

  VALUE       — cheap vs peers (P/E, P/B, EV/EBITDA, earnings yield, FCF yield)
  QUALITY     — profitability & F-Score (ROE, ROIC, margins, Piotroski)
  GROWTH      — revenue/EPS momentum (1y/3y growth rates)
  EARNINGS_Q  — accruals (CFO − NI) / assets
  LEVERAGE    — current ratio, D/E, interest coverage
  COMPOSITE   — weighted blend of the available style scores

Also stores sector-relative ranks of the value and quality style scores.
A sector rank is omitted when fewer than three names in the sector have that style.

Usage:
    python -m pipeline.compute.factor_scores
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import numpy as np
from dotenv import load_dotenv

from pipeline.compute.fundamental_analysis import build_fundamental_analysis
from pipeline.utils.supabase import fetch_all

load_dotenv()
logger = logging.getLogger(__name__)

# Composite weights (sum = 1.0). Renormalized per name when a style is missing.
WEIGHTS = {
    "value": 0.25,
    "quality": 0.25,
    "growth": 0.20,
    "earnings_quality": 0.15,
    "leverage": 0.15,
}

INTEREST_COVERAGE_CAP = 50.0
MIN_SECTOR_PEERS = 3


def percentile_ranks(values: np.ndarray, *, higher_is_better: bool = True) -> np.ndarray:
    """Map finite values to 0–100 average ranks. NaN stays NaN.

    A single finite observation has no peer set and scores 50. Ties share the
    average of the ranks they span, so identical inputs cannot drift apart
    when row order changes.
    """
    values = np.asarray(values, dtype=float)
    out = np.full(values.shape, np.nan, dtype=float)
    idx = np.flatnonzero(np.isfinite(values))
    n = int(idx.size)
    if n == 0:
        return out
    if n == 1:
        out[idx] = 50.0
        return out
    vals = values[idx]
    order = np.argsort(vals, kind="mergesort")
    sorted_vals = vals[order]
    ranks = np.empty(n, dtype=float)
    start = 0
    while start < n:
        end = start + 1
        while end < n and sorted_vals[end] == sorted_vals[start]:
            end += 1
        avg = (start + 1 + end) / 2.0
        ranks[order[start:end]] = avg
        start = end
    pct = (ranks - 1.0) / (n - 1.0) * 100.0
    if not higher_is_better:
        pct = 100.0 - pct
    out[idx] = pct
    return out


def average_available(components: list[np.ndarray]) -> np.ndarray:
    """Equal-weight mean of finite component ranks. All-missing stays NaN."""
    if not components:
        return np.array([], dtype=float)
    stacked = np.vstack(components)
    finite = np.isfinite(stacked)
    count = finite.sum(axis=0)
    total = np.where(finite, stacked, 0.0).sum(axis=0)
    out = np.full(count.shape, np.nan, dtype=float)
    ok = count > 0
    out[ok] = total[ok] / count[ok]
    return out


def weighted_available(scores: dict[str, np.ndarray], weights: dict[str, float]) -> np.ndarray:
    """Weighted mean, renormalized over styles that are finite for that name."""
    keys = [k for k in weights if k in scores]
    n = len(scores[keys[0]]) if keys else 0
    num = np.zeros(n, dtype=float)
    den = np.zeros(n, dtype=float)
    for key in keys:
        w = float(weights[key])
        col = np.asarray(scores[key], dtype=float)
        ok = np.isfinite(col)
        num = np.where(ok, num + w * col, num)
        den = np.where(ok, den + w, den)
    out = np.full(n, np.nan, dtype=float)
    ok = den > 0
    out[ok] = num[ok] / den[ok]
    return out


def _column(rows: list[dict], key: str, *, positive_only: bool = False, cap: float | None = None) -> np.ndarray:
    arr = np.full(len(rows), np.nan, dtype=float)
    for i, row in enumerate(rows):
        raw = row.get(key)
        if raw is None:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if not np.isfinite(value):
            continue
        if positive_only and value <= 0:
            continue
        if cap is not None:
            value = min(value, cap)
        arr[i] = value
    return arr


def _optional_column(values: list[float | None], *, cap: float | None = None) -> np.ndarray:
    arr = np.full(len(values), np.nan, dtype=float)
    for i, raw in enumerate(values):
        if raw is None:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if not np.isfinite(value):
            continue
        if cap is not None:
            value = min(value, cap)
        arr[i] = value
    return arr


def sector_style_ranks(scores: np.ndarray, sectors: list[str]) -> np.ndarray:
    """Percentile of a style score inside its sector. NaN and thin sectors stay NaN."""
    out = np.full(len(scores), np.nan, dtype=float)
    by_sector: dict[str, list[int]] = {}
    for i, sector in enumerate(sectors):
        if not np.isfinite(scores[i]):
            continue
        by_sector.setdefault(sector or "Unknown", []).append(i)
    for idx in by_sector.values():
        if len(idx) < MIN_SECTOR_PEERS:
            continue
        sub = percentile_ranks(scores[np.array(idx)], higher_is_better=True)
        for j, i in enumerate(idx):
            out[i] = sub[j]
    return out


def score_cross_section(
    rows: list[dict],
    accruals: list[float | None],
    interest_coverage: list[float | None],
    sectors: list[str],
) -> dict[str, np.ndarray]:
    """Rank each fundamental input, then blend. See module docstring."""
    if len(rows) != len(accruals) or len(rows) != len(interest_coverage) or len(rows) != len(sectors):
        raise ValueError("rows, accruals, interest coverage, and sectors must be aligned")

    value = average_available([
        percentile_ranks(_column(rows, "pe_ratio", positive_only=True), higher_is_better=False),
        percentile_ranks(_column(rows, "pb_ratio", positive_only=True), higher_is_better=False),
        percentile_ranks(_column(rows, "ev_ebitda", positive_only=True), higher_is_better=False),
        percentile_ranks(_column(rows, "earnings_yield"), higher_is_better=True),
        percentile_ranks(_column(rows, "fcf_yield"), higher_is_better=True),
    ])
    quality = average_available([
        percentile_ranks(_column(rows, "roe")),
        percentile_ranks(_column(rows, "roic")),
        percentile_ranks(_column(rows, "roa")),
        percentile_ranks(_column(rows, "gross_margin")),
        percentile_ranks(_column(rows, "operating_margin")),
        percentile_ranks(_column(rows, "net_margin")),
        percentile_ranks(_column(rows, "f_score")),
    ])
    growth = average_available([
        percentile_ranks(_column(rows, "revenue_growth_1y")),
        percentile_ranks(_column(rows, "revenue_growth_3y")),
        percentile_ranks(_column(rows, "eps_growth_1y")),
        percentile_ranks(_column(rows, "net_income_growth_1y")),
    ])
    earnings_quality = percentile_ranks(_optional_column(accruals), higher_is_better=True)
    leverage = average_available([
        percentile_ranks(_column(rows, "current_ratio")),
        percentile_ranks(_column(rows, "debt_to_equity"), higher_is_better=False),
        percentile_ranks(
            _optional_column(interest_coverage, cap=INTEREST_COVERAGE_CAP),
            higher_is_better=True,
        ),
    ])
    styles = {
        "value": value,
        "quality": quality,
        "growth": growth,
        "earnings_quality": earnings_quality,
        "leverage": leverage,
    }
    return {
        **styles,
        "composite": weighted_available(styles, WEIGHTS),
        "sector_value": sector_style_ranks(value, sectors),
        "sector_quality": sector_style_ranks(quality, sectors),
    }


def _as_int(value: float) -> int | None:
    if value is None or not np.isfinite(value):
        return None
    return int(round(float(value)))


def _as_float(value: float, digits: int) -> float | None:
    if value is None or not np.isfinite(value):
        return None
    return round(float(value), digits)


def main() -> None:
    from pipeline.utils.run_recorded import run_recorded

    run_recorded("compute.factor_scores", _run_factor_scores)


def _run_factor_scores(sb, run) -> None:
    logger.info("=== Factor Scores Compute Start ===")

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

    accruals: list[float | None] = []
    interest_cov: list[float | None] = []
    sectors: list[str] = []
    for row in fundamentals:
        extra = fin_extras.get(row["symbol"], {})
        accruals.append(extra.get("accruals_ratio"))
        interest_cov.append(extra.get("interest_coverage"))
        sectors.append(sector_map.get(row["symbol"], "Unknown"))

    scored = score_cross_section(fundamentals, accruals, interest_cov, sectors)

    updates: list[dict] = []
    verdict_counts: dict[str, int] = {}
    for i, row in enumerate(fundamentals):
        value_score = _as_int(scored["value"][i])
        quality_score = _as_int(scored["quality"][i])
        growth_score = _as_int(scored["growth"][i])
        earn_q_score = _as_int(scored["earnings_quality"][i])
        leverage_score = _as_int(scored["leverage"][i])
        composite = _as_int(scored["composite"][i])
        analysis = build_fundamental_analysis(
            f_score=row.get("f_score"),
            f_score_detail=row.get("f_score_detail"),
            composite_factor_score=composite,
            value_score=value_score,
            quality_score=quality_score,
            growth_score=growth_score,
            earnings_quality_score=earn_q_score,
            leverage_score=leverage_score,
            pe_ratio=row.get("pe_ratio"),
            roe=row.get("roe"),
            net_margin=row.get("net_margin"),
            revenue_growth_1y=row.get("revenue_growth_1y"),
            debt_to_equity=row.get("debt_to_equity"),
            accruals_ratio=accruals[i],
            interest_coverage=interest_cov[i],
        )
        verdict_counts[analysis.verdict] = verdict_counts.get(analysis.verdict, 0) + 1
        updates.append({
            "symbol": row["symbol"],
            "value_score": value_score,
            "quality_score": quality_score,
            "growth_score": growth_score,
            "earnings_quality_score": earn_q_score,
            "leverage_score": leverage_score,
            "composite_factor_score": composite,
            "sector_value_pctile": _as_float(scored["sector_value"][i], 1),
            "sector_quality_pctile": _as_float(scored["sector_quality"][i], 1),
            "accruals_ratio": round(accruals[i], 6) if accruals[i] is not None else None,
            "interest_coverage": round(interest_cov[i], 2) if interest_cov[i] is not None else None,
            "factor_computed_at": now,
            **analysis.as_row_fields(),
        })

    batch_size = 500
    for j in range(0, len(updates), batch_size):
        batch = updates[j : j + batch_size]
        try:
            sb.table("fundamentals_snapshot").upsert(batch, on_conflict="symbol").execute()
        except Exception:
            logger.exception("Failed to upsert factor batch %d-%d", j, j + len(batch))

    ranked = [t for t in updates if t["composite_factor_score"] is not None]
    top = sorted(ranked, key=lambda x: x["composite_factor_score"], reverse=True)[:5]
    verdict_dist = " | ".join(f"{k}={v}" for k, v in sorted(verdict_counts.items()))
    logger.info(
        "=== Factor Scores Complete: %d symbols | Top composite: %s | Verdicts: %s ===",
        len(updates),
        ", ".join(f"{t['symbol']}={t['composite_factor_score']}" for t in top),
        verdict_dist,
    )
    run.set_headline(f"{len(updates)} symbols · {verdict_dist[:100]}")
    run.set_row_counts(symbols=len(updates))


def _fetch_financial_extras(sb) -> dict[str, dict]:
    """Per-symbol accruals ratio and interest coverage from latest FY reports."""
    extras: dict[str, dict] = {}

    from datetime import date as date_cls

    from pipeline.utils.pit_reports import latest_fy_reports_as_of

    as_of = date_cls.today()
    for report_type, key in [("income", "income"), ("balance", "balance"), ("cashflow", "cashflow")]:
        report_rows = fetch_all(
            sb,
            "financial_reports",
            "symbol, date, filing_date, data",
            filters=lambda q, rt=report_type: q.eq("report_type", rt).eq("period", "FY"),
            order=("date", True),
        )
        by_sym: dict[str, list[dict]] = {}
        for r in report_rows:
            by_sym.setdefault(r["symbol"], []).append(r)
        for sym, sym_rows in by_sym.items():
            known = latest_fy_reports_as_of(sym_rows, as_of, max_reports=1)
            if not known:
                continue
            if sym not in extras:
                extras[sym] = {}
            extras[sym][key] = known[0]

    for _sym, reports in extras.items():
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


if __name__ == "__main__":
    main()
