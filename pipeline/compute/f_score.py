"""Piotroski F-Score computation.

Computes the 9-point Piotroski F-Score for each stock using
financial_reports (current + prior FY). Persists score and per-test
component breakdown to fundamentals_snapshot.

Score components:
  PROFITABILITY (4 pts):
    1. ROA > 0
    2. Operating Cash Flow > 0
    3. Delta ROA > 0
    4. CFO > Net Income

  LEVERAGE / LIQUIDITY (3 pts):
    5. Delta Long-Term Debt down
    6. Delta Current Ratio up
    7. No share dilution

  OPERATING EFFICIENCY (2 pts):
    8. Delta Gross Margin up
    9. Delta Asset Turnover up

Usage:
    python -m pipeline.compute.f_score
"""
from __future__ import annotations

import logging
from typing import Any

from dotenv import load_dotenv
from supabase import create_client, Client

from pipeline.config.settings import SupabaseConfig

load_dotenv()

logger = logging.getLogger(__name__)

COMPONENT_KEYS = (
    "roa_positive",
    "cfo_positive",
    "delta_roa",
    "accruals_quality",
    "delta_ltd",
    "delta_current_ratio",
    "no_dilution",
    "delta_gross_margin",
    "delta_asset_turnover",
)


def _get_supabase_client() -> Client:
    cfg = SupabaseConfig()
    if not cfg.url or not cfg.service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(cfg.url, cfg.service_key)


def _safe_div(a, b):
    """Safe division, returns None if either operand is None or b is zero."""
    if a is None or b is None or b == 0:
        return None
    return a / b


def _fetch_all_reports(sb: Client, report_type: str) -> dict[str, list[dict]]:
    """Fetch all FY reports of a given type in bulk, grouped by symbol.

    Returns {symbol: [newest_data, second_newest_data]} — at most 2 per symbol.
    """
    from pipeline.utils.supabase import fetch_all

    all_rows = fetch_all(
        sb,
        "financial_reports",
        "symbol, date, data",
        filters=lambda q, rt=report_type: q.eq("report_type", rt).eq("period", "FY"),
        order=("date", True),
    )
    logger.info("Fetched %d %s report rows", len(all_rows), report_type)

    grouped: dict[str, list[dict]] = {}
    for r in all_rows:
        sym = r["symbol"]
        if sym not in grouped:
            grouped[sym] = []
        if len(grouped[sym]) < 2:
            grouped[sym].append(r["data"])

    return grouped


def compute_f_score_detail(
    income_cur: dict | None,
    income_pri: dict | None,
    balance_cur: dict | None,
    balance_pri: dict | None,
    cashflow_cur: dict | None,
) -> dict[str, Any] | None:
    """Compute F-Score with boolean component breakdown. Returns None if data insufficient."""
    if not income_cur or not balance_cur or not income_pri or not balance_pri:
        return None

    components: dict[str, bool] = {k: False for k in COMPONENT_KEYS}

    net_income = income_cur.get("netIncome")
    total_assets_beg = balance_pri.get("totalAssets")
    roa = _safe_div(net_income, total_assets_beg)
    components["roa_positive"] = roa is not None and roa > 0

    cfo = cashflow_cur.get("operatingCashFlow") if cashflow_cur else None
    components["cfo_positive"] = cfo is not None and cfo > 0

    prior_ni = income_pri.get("netIncome")
    prior_ta_beg = balance_pri.get("totalAssets")
    prior_roa = _safe_div(prior_ni, prior_ta_beg)
    components["delta_roa"] = (
        roa is not None and prior_roa is not None and roa > prior_roa
    )

    components["accruals_quality"] = (
        cfo is not None and net_income is not None and cfo > net_income
    )

    ltd_cur = balance_cur.get("longTermDebt")
    ltd_pri = balance_pri.get("longTermDebt")
    components["delta_ltd"] = (
        ltd_cur is not None and ltd_pri is not None and ltd_cur < ltd_pri
    )

    cr_cur = _safe_div(
        balance_cur.get("totalCurrentAssets"),
        balance_cur.get("totalCurrentLiabilities"),
    )
    cr_pri = _safe_div(
        balance_pri.get("totalCurrentAssets"),
        balance_pri.get("totalCurrentLiabilities"),
    )
    components["delta_current_ratio"] = (
        cr_cur is not None and cr_pri is not None and cr_cur > cr_pri
    )

    shares_cur = income_cur.get("weightedAverageShsOutDil") or income_cur.get(
        "weightedAverageShsOut"
    )
    shares_pri = income_pri.get("weightedAverageShsOutDil") or income_pri.get(
        "weightedAverageShsOut"
    )
    components["no_dilution"] = bool(
        shares_cur and shares_pri and shares_cur <= shares_pri
    )

    gm_cur = _safe_div(income_cur.get("grossProfit"), income_cur.get("revenue"))
    gm_pri = _safe_div(income_pri.get("grossProfit"), income_pri.get("revenue"))
    components["delta_gross_margin"] = (
        gm_cur is not None and gm_pri is not None and gm_cur > gm_pri
    )

    at_cur = _safe_div(income_cur.get("revenue"), total_assets_beg)
    at_pri = _safe_div(income_pri.get("revenue"), prior_ta_beg)
    components["delta_asset_turnover"] = (
        at_cur is not None and at_pri is not None and at_cur > at_pri
    )

    score = sum(1 for v in components.values() if v)
    return {
        "score": score,
        "components": components,
        "groups": {
            "profitability": sum(
                1
                for k in (
                    "roa_positive",
                    "cfo_positive",
                    "delta_roa",
                    "accruals_quality",
                )
                if components[k]
            ),
            "leverage_liquidity": sum(
                1
                for k in ("delta_ltd", "delta_current_ratio", "no_dilution")
                if components[k]
            ),
            "operating_efficiency": sum(
                1
                for k in ("delta_gross_margin", "delta_asset_turnover")
                if components[k]
            ),
        },
    }


def compute_f_score(
    income_cur: dict | None,
    income_pri: dict | None,
    balance_cur: dict | None,
    balance_pri: dict | None,
    cashflow_cur: dict | None,
) -> int | None:
    """Compute Piotroski F-Score from pre-loaded report data. Returns 0-9 or None."""
    detail = compute_f_score_detail(
        income_cur, income_pri, balance_cur, balance_pri, cashflow_cur
    )
    return None if detail is None else int(detail["score"])


def main() -> None:
    """Compute F-Score for all universe members and update fundamentals_snapshot."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== F-Score Compute Start ===")

    sb = _get_supabase_client()

    from pipeline.utils.supabase import fetch_all

    symbol_rows = fetch_all(sb, "fundamentals_snapshot", "symbol")
    symbols = {r["symbol"] for r in symbol_rows}
    logger.info("Computing F-Score for %d symbols", len(symbols))

    logger.info("Pre-fetching financial reports...")
    income_reports = _fetch_all_reports(sb, "income")
    balance_reports = _fetch_all_reports(sb, "balance")
    cashflow_reports = _fetch_all_reports(sb, "cashflow")
    logger.info(
        "Reports loaded: %d income, %d balance, %d cashflow symbols",
        len(income_reports),
        len(balance_reports),
        len(cashflow_reports),
    )

    computed = 0
    scores: dict[int, int] = {}
    updates: list[dict] = []

    for symbol in symbols:
        try:
            income = income_reports.get(symbol, [])
            balance = balance_reports.get(symbol, [])
            cashflow = cashflow_reports.get(symbol, [])

            income_cur = income[0] if income else None
            income_pri = income[1] if len(income) > 1 else None
            balance_cur = balance[0] if balance else None
            balance_pri = balance[1] if len(balance) > 1 else None
            cashflow_cur = cashflow[0] if cashflow else None

            detail = compute_f_score_detail(
                income_cur, income_pri, balance_cur, balance_pri, cashflow_cur
            )
            if detail is not None:
                f = int(detail["score"])
                updates.append(
                    {
                        "symbol": symbol,
                        "f_score": f,
                        "f_score_detail": detail,
                    }
                )
                computed += 1
                scores[f] = scores.get(f, 0) + 1
        except Exception:
            logger.exception("Failed to compute F-Score for %s", symbol)

    logger.info("Upserting %d F-Score updates...", len(updates))
    batch_size = 500
    for i in range(0, len(updates), batch_size):
        batch = updates[i : i + batch_size]
        try:
            sb.table("fundamentals_snapshot").upsert(batch, on_conflict="symbol").execute()
        except Exception:
            logger.exception("Failed to upsert F-Score batch %d-%d", i, i + len(batch))

    dist = " | ".join(f"F{k}={v}" for k, v in sorted(scores.items()))
    logger.info(
        "=== F-Score Compute Complete: %d scored | Distribution: %s ===",
        computed,
        dist,
    )


if __name__ == "__main__":
    main()
