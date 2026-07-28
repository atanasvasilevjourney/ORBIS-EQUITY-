"""Piotroski F-Score computation.

Computes the 9-point Piotroski F-Score for each stock using
fundamentals_snapshot (current) + financial_reports (prior year).

Score components:
  PROFITABILITY (4 pts):
    1. ROA > 0                          (positive net income / total assets)
    2. Operating Cash Flow > 0          (CFO positive)
    3. Delta ROA > 0                    (ROA improved YoY)
    4. CFO > Net Income                 (accruals quality)

  LEVERAGE / LIQUIDITY (3 pts):
    5. Delta Long-Term Debt down        (leverage decreased)
    6. Delta Current Ratio up           (liquidity improved)
    7. No share dilution                (shares outstanding didn't increase)

  OPERATING EFFICIENCY (2 pts):
    8. Delta Gross Margin up            (margins improved)
    9. Delta Asset Turnover up          (revenue/assets improved)

Usage:
    python -m pipeline.compute.f_score
"""
import logging
import os

from dotenv import load_dotenv
from supabase import create_client, Client

from pipeline.config.settings import SupabaseConfig

load_dotenv()

logger = logging.getLogger(__name__)


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


def _get_latest_two_reports(sb: Client, symbol: str, report_type: str) -> tuple[dict | None, dict | None]:
    """Fetch the two most recent FY reports for a symbol (current, prior)."""
    resp = (
        sb.table("financial_reports")
        .select("data")
        .eq("symbol", symbol)
        .eq("report_type", report_type)
        .eq("period", "FY")
        .order("date", desc=True)
        .limit(2)
        .execute()
    )
    rows = resp.data or []
    current = rows[0]["data"] if len(rows) > 0 else None
    prior = rows[1]["data"] if len(rows) > 1 else None
    return current, prior


def compute_f_score(sb: Client, symbol: str) -> int | None:
    """Compute Piotroski F-Score for a single symbol. Returns 0-9 or None."""
    income_cur, income_pri = _get_latest_two_reports(sb, symbol, "income")
    balance_cur, balance_pri = _get_latest_two_reports(sb, symbol, "balance")
    cashflow_cur, _ = _get_latest_two_reports(sb, symbol, "cashflow")

    if not income_cur or not balance_cur:
        return None

    score = 0

    # --- PROFITABILITY ---

    # 1. ROA > 0
    net_income = income_cur.get("netIncome")
    total_assets = balance_cur.get("totalAssets")
    roa = _safe_div(net_income, total_assets)
    if roa is not None and roa > 0:
        score += 1

    # 2. Operating Cash Flow > 0
    cfo = cashflow_cur.get("operatingCashFlow") if cashflow_cur else None
    if cfo is not None and cfo > 0:
        score += 1

    # 3. Delta ROA > 0 (improved from prior year)
    if income_pri and balance_pri:
        prior_ni = income_pri.get("netIncome")
        prior_ta = balance_pri.get("totalAssets")
        prior_roa = _safe_div(prior_ni, prior_ta)
        if roa is not None and prior_roa is not None and roa > prior_roa:
            score += 1

    # 4. Accruals: CFO > Net Income
    if cfo is not None and net_income is not None and cfo > net_income:
        score += 1

    # --- LEVERAGE / LIQUIDITY ---

    # 5. Delta long-term debt decreased
    ltd_cur = balance_cur.get("longTermDebt", 0) or 0
    if balance_pri:
        ltd_pri = balance_pri.get("longTermDebt", 0) or 0
        if ltd_cur < ltd_pri:
            score += 1

    # 6. Delta current ratio improved
    tca = balance_cur.get("totalCurrentAssets")
    tcl = balance_cur.get("totalCurrentLiabilities")
    cr_cur = _safe_div(tca, tcl)
    if balance_pri:
        tca_pri = balance_pri.get("totalCurrentAssets")
        tcl_pri = balance_pri.get("totalCurrentLiabilities")
        cr_pri = _safe_div(tca_pri, tcl_pri)
        if cr_cur is not None and cr_pri is not None and cr_cur > cr_pri:
            score += 1

    # 7. No dilution (shares outstanding didn't increase)
    shares_cur = income_cur.get("weightedAverageShsOutDil") or income_cur.get("weightedAverageShsOut")
    if income_pri:
        shares_pri = income_pri.get("weightedAverageShsOutDil") or income_pri.get("weightedAverageShsOut")
        if shares_cur and shares_pri and shares_cur <= shares_pri:
            score += 1

    # --- OPERATING EFFICIENCY ---

    # 8. Delta gross margin improved
    gm_cur = _safe_div(income_cur.get("grossProfit"), income_cur.get("revenue"))
    if income_pri:
        gm_pri = _safe_div(income_pri.get("grossProfit"), income_pri.get("revenue"))
        if gm_cur is not None and gm_pri is not None and gm_cur > gm_pri:
            score += 1

    # 9. Delta asset turnover improved (revenue / total assets)
    at_cur = _safe_div(income_cur.get("revenue"), total_assets)
    if income_pri and balance_pri:
        at_pri = _safe_div(income_pri.get("revenue"), balance_pri.get("totalAssets"))
        if at_cur is not None and at_pri is not None and at_cur > at_pri:
            score += 1

    return score


def main() -> None:
    """Compute F-Score for all universe members and update fundamentals_snapshot."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== F-Score Compute Start ===")

    sb = _get_supabase_client()

    # Get all symbols that have fundamentals
    resp = sb.table("fundamentals_snapshot").select("symbol").execute()
    symbols = [r["symbol"] for r in (resp.data or [])]
    logger.info("Computing F-Score for %d symbols", len(symbols))

    computed = 0
    scores: dict[int, int] = {}  # distribution

    for i, symbol in enumerate(symbols):
        try:
            f = compute_f_score(sb, symbol)
            if f is not None:
                sb.table("fundamentals_snapshot").update(
                    {"f_score": f}
                ).eq("symbol", symbol).execute()
                computed += 1
                scores[f] = scores.get(f, 0) + 1
        except Exception:
            logger.exception("Failed to compute F-Score for %s", symbol)

        if (i + 1) % 100 == 0:
            logger.info("Progress: %d/%d symbols processed", i + 1, len(symbols))

    dist = " | ".join(f"F{k}={v}" for k, v in sorted(scores.items()))
    logger.info("=== F-Score Compute Complete: %d scored | Distribution: %s ===", computed, dist)


if __name__ == "__main__":
    main()
