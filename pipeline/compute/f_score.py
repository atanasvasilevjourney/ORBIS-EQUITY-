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


def _fetch_all_reports(sb: Client, report_type: str) -> dict[str, list[dict]]:
    """Fetch all FY reports of a given type in bulk, grouped by symbol.

    Returns {symbol: [newest_data, second_newest_data]} — at most 2 per symbol.
    Uses paginated queries to avoid the 5000-row Supabase limit.
    """
    page_size = 5000
    offset = 0
    all_rows: list[dict] = []

    while True:
        resp = (
            sb.table("financial_reports")
            .select("symbol, data")
            .eq("report_type", report_type)
            .eq("period", "FY")
            .order("symbol")
            .order("date", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = resp.data or []
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size

    logger.info("Fetched %d %s report rows", len(all_rows), report_type)

    # Group by symbol, keep only latest 2 (already sorted newest-first per symbol)
    grouped: dict[str, list[dict]] = {}
    for r in all_rows:
        sym = r["symbol"]
        if sym not in grouped:
            grouped[sym] = []
        if len(grouped[sym]) < 2:
            grouped[sym].append(r["data"])

    return grouped


def compute_f_score(
    income_cur: dict | None, income_pri: dict | None,
    balance_cur: dict | None, balance_pri: dict | None,
    cashflow_cur: dict | None,
) -> int | None:
    """Compute Piotroski F-Score from pre-loaded report data. Returns 0-9 or None."""
    if not income_cur or not balance_cur:
        return None

    # Need prior-year data for 6 of 9 tests — return None if absent
    if not income_pri or not balance_pri:
        return None

    score = 0

    # --- PROFITABILITY ---

    # 1. ROA > 0 (using beginning-of-year assets per Piotroski 2000)
    net_income = income_cur.get("netIncome")
    total_assets_beg = balance_pri.get("totalAssets")  # beginning-of-year = prior year-end
    total_assets_cur = balance_cur.get("totalAssets")
    roa = _safe_div(net_income, total_assets_beg)
    if roa is not None and roa > 0:
        score += 1

    # 2. Operating Cash Flow > 0
    cfo = cashflow_cur.get("operatingCashFlow") if cashflow_cur else None
    if cfo is not None and cfo > 0:
        score += 1

    # 3. Delta ROA > 0 (improved from prior year)
    prior_ni = income_pri.get("netIncome")
    # Beginning-of-prior-year assets = two years back (balance[2] if available)
    prior_ta_beg = balance_pri.get("totalAssets")  # fallback: prior year-end
    prior_roa = _safe_div(prior_ni, prior_ta_beg)
    if roa is not None and prior_roa is not None and roa > prior_roa:
        score += 1

    # 4. Accruals: CFO > Net Income
    if cfo is not None and net_income is not None and cfo > net_income:
        score += 1

    # --- LEVERAGE / LIQUIDITY ---

    # 5. Delta long-term debt decreased
    ltd_cur = balance_cur.get("longTermDebt")
    ltd_pri = balance_pri.get("longTermDebt")
    if ltd_cur is not None and ltd_pri is not None and ltd_cur < ltd_pri:
        score += 1

    # 6. Delta current ratio improved
    tca = balance_cur.get("totalCurrentAssets")
    tcl = balance_cur.get("totalCurrentLiabilities")
    cr_cur = _safe_div(tca, tcl)
    tca_pri = balance_pri.get("totalCurrentAssets")
    tcl_pri = balance_pri.get("totalCurrentLiabilities")
    cr_pri = _safe_div(tca_pri, tcl_pri)
    if cr_cur is not None and cr_pri is not None and cr_cur > cr_pri:
        score += 1

    # 7. No dilution (shares outstanding didn't increase)
    shares_cur = income_cur.get("weightedAverageShsOutDil") or income_cur.get("weightedAverageShsOut")
    shares_pri = income_pri.get("weightedAverageShsOutDil") or income_pri.get("weightedAverageShsOut")
    if shares_cur and shares_pri and shares_cur <= shares_pri:
        score += 1

    # --- OPERATING EFFICIENCY ---

    # 8. Delta gross margin improved
    gm_cur = _safe_div(income_cur.get("grossProfit"), income_cur.get("revenue"))
    gm_pri = _safe_div(income_pri.get("grossProfit"), income_pri.get("revenue"))
    if gm_cur is not None and gm_pri is not None and gm_cur > gm_pri:
        score += 1

    # 9. Delta asset turnover improved (revenue / beginning-of-year assets)
    at_cur = _safe_div(income_cur.get("revenue"), total_assets_beg)
    at_pri = _safe_div(income_pri.get("revenue"), prior_ta_beg)
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
    from pipeline.utils.supabase import fetch_all

    symbol_rows = fetch_all(sb, "fundamentals_snapshot", "symbol")
    symbols = {r["symbol"] for r in symbol_rows}
    logger.info("Computing F-Score for %d symbols", len(symbols))

    # Pre-fetch ALL financial reports in bulk (3 queries instead of 6N)
    logger.info("Pre-fetching financial reports...")
    income_reports = _fetch_all_reports(sb, "income")
    balance_reports = _fetch_all_reports(sb, "balance")
    cashflow_reports = _fetch_all_reports(sb, "cashflow")
    logger.info(
        "Reports loaded: %d income, %d balance, %d cashflow symbols",
        len(income_reports), len(balance_reports), len(cashflow_reports),
    )

    # Compute F-Score for each symbol using in-memory data
    computed = 0
    scores: dict[int, int] = {}  # distribution
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

            f = compute_f_score(income_cur, income_pri, balance_cur, balance_pri, cashflow_cur)
            if f is not None:
                updates.append({"symbol": symbol, "f_score": f})
                computed += 1
                scores[f] = scores.get(f, 0) + 1
        except Exception:
            logger.exception("Failed to compute F-Score for %s", symbol)

    # Batch upsert all scores (1-2 queries instead of N)
    logger.info("Upserting %d F-Score updates...", len(updates))
    batch_size = 500
    for i in range(0, len(updates), batch_size):
        batch = updates[i : i + batch_size]
        try:
            sb.table("fundamentals_snapshot").upsert(batch, on_conflict="symbol").execute()
        except Exception:
            logger.exception("Failed to upsert F-Score batch %d-%d", i, i + len(batch))

    dist = " | ".join(f"F{k}={v}" for k, v in sorted(scores.items()))
    logger.info("=== F-Score Compute Complete: %d scored | Distribution: %s ===", computed, dist)


if __name__ == "__main__":
    main()
