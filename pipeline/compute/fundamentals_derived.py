"""Derive trailing valuation, growth, ROIC, and leverage from reports + live price."""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from pipeline.fundamentals.sector_class import is_financial_sector
from pipeline.utils.market_cap import normalize_market_cap_usd
from pipeline.utils.pit_reports import latest_fy_reports_as_of, latest_fy_rows_as_of
from pipeline.utils.supabase import fetch_all

logger = logging.getLogger(__name__)
_CONFIG = Path(__file__).resolve().parents[2] / "shared" / "fundamentals_config.json"


def _config() -> dict[str, Any]:
    with _CONFIG.open(encoding="utf-8") as fh:
        return json.load(fh)


def _f(data: dict | None, *keys: str) -> float | None:
    if not data:
        return None
    for k in keys:
        v = data.get(k)
        if v is not None:
            try:
                x = float(v)
                if x == x:
                    return x
            except (TypeError, ValueError):
                continue
    return None


def _growth_ratio(cur: float | None, pri: float | None, years: int = 1) -> float | None:
    if cur is None or pri is None or pri == 0:
        return None
    if years <= 0:
        return None
    try:
        ratio = cur / pri
        # A negative base to a fractional power is complex in Python and cannot be stored.
        if ratio < 0 and years != 1:
            return None
        value = ratio ** (1.0 / years) - 1.0
    except (ValueError, ZeroDivisionError, OverflowError):
        return None
    if isinstance(value, complex):
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    if value != value:
        return None
    return value


def derive_from_reports(
    *,
    income_cur: dict | None,
    income_pri: dict | None,
    income_old: dict | None,
    balance_cur: dict | None,
    cashflow_cur: dict | None,
    growth_cur: dict | None,
    metrics_cur: dict | None,
    price: float | None,
    sector: str | None,
    industry: str | None,
) -> dict[str, Any]:
    def _blob(row: dict | None) -> dict:
        if not row:
            return {}
        d = row.get("data")
        return d if isinstance(d, dict) else row

    inc = _blob(income_cur)
    inc_p = _blob(income_pri)
    inc_o = _blob(income_old)
    bal = _blob(balance_cur)
    cf = _blob(cashflow_cur)
    gro = _blob(growth_cur)
    met = _blob(metrics_cur)

    financial = is_financial_sector(sector, industry)

    revenue = _f(inc, "revenue")
    ni = _f(inc, "netIncome")
    ebitda = _f(inc, "ebitda", "operatingIncome")
    eps = _f(inc, "epsDiluted", "eps", "epsdiluted")
    interest = _f(inc, "interestExpense")
    ebit = _f(inc, "operatingIncome", "ebit")

    ta = _f(bal, "totalAssets")
    equity = _f(bal, "totalStockholdersEquity", "totalEquity")
    debt = _f(bal, "totalDebt")
    cash = _f(bal, "cashAndCashEquivalents", "cashAndShortTermInvestments")
    cfo = _f(cf, "operatingCashFlow")
    capex = _f(cf, "capitalExpenditure")
    if capex is not None and capex > 0:
        capex = -abs(capex)
    fcf = _f(cf, "freeCashFlow")
    if fcf is None and cfo is not None and capex is not None:
        fcf = cfo + capex

    out: dict[str, Any] = {}

    if price and eps and eps > 0:
        out["pe_ratio"] = round(price / eps, 2)
        out["earnings_yield"] = round(eps / price, 4)

    mcap_raw = None
    if price and eps and eps > 0:
        sh = _f(inc, "weightedAverageShsOutDil", "weightedAverageShsOut")
        if sh and sh > 0:
            mcap_raw = price * sh
    mcap = normalize_market_cap_usd(mcap_raw, price) if mcap_raw else None
    if mcap:
        out["market_cap"] = mcap
        if fcf is not None:
            out["fcf_yield"] = round(fcf / mcap, 4)

    rev_g1 = _f(gro, "revenueGrowth", "growthRevenue") or _growth_ratio(revenue, _f(inc_p, "revenue"), 1)
    rev_g3 = _f(gro, "threeYRevenueGrowthPerShare", "revenueGrowth3Y") or _growth_ratio(
        revenue, _f(inc_o, "revenue"), 3
    )
    ni_g1 = _f(gro, "netIncomeGrowth", "growthNetIncome") or _growth_ratio(ni, _f(inc_p, "netIncome"), 1)
    if rev_g1 is not None:
        out["revenue_growth_1y"] = round(rev_g1, 4)
    if rev_g3 is not None:
        out["revenue_growth_3y"] = round(rev_g3, 4)
    if ni_g1 is not None:
        out["net_income_growth_1y"] = round(ni_g1, 4)

    if not financial:
        gp = _f(inc, "grossProfit")
        if revenue and revenue != 0 and gp is not None:
            out["gross_margin"] = round(gp / revenue, 4)

    # ROIC / ROA / ROE from statements when screener empty
    if ta and ni is not None:
        out["roa"] = round(ni / ta, 4)
    if equity and equity > 0 and ni is not None:
        out["roe"] = round(ni / equity, 4)

    debt_sb = _f(bal, "shortTermDebt", "shortLongTermDebt") or 0
    ltd = _f(bal, "longTermDebt") or 0
    total_debt = debt if debt is not None else debt_sb + ltd
    net_debt = None
    if total_debt is not None and cash is not None:
        net_debt = total_debt - cash

    if equity and equity > 0 and total_debt is not None:
        out["debt_to_equity"] = round(total_debt / equity, 3)
    elif net_debt is not None and ebitda and ebitda > 0:
        nd_ebitda = net_debt / ebitda
        out["debt_to_equity"] = round(min(10.0, max(0.0, nd_ebitda)), 3)

    if ebit is not None and interest is not None and abs(interest) > 0:
        out["interest_coverage"] = round(ebit / abs(interest), 2)

    if cfo is not None and ni is not None and ta and ta > 0:
        out["accruals_ratio"] = round((cfo - ni) / ta, 4)

    # ROIC
    invested = None
    if equity is not None and total_debt is not None:
        invested = equity + total_debt - (cash or 0)
    roic_met = _f(met, "returnOnInvestedCapital", "roic")
    if roic_met is not None:
        out["roic"] = round(roic_met, 4)
    elif invested and invested > 0 and ebit is not None:
        tax = 0.21
        nopat = ebit * (1 - tax)
        out["roic"] = round(nopat / invested, 4)

    return out


# Snapshot columns a statement can fill when the screener left them empty.
_STATEMENT_PATCH_KEYS = (
    "revenue",
    "gross_profit",
    "operating_income",
    "net_income",
    "ebitda",
    "eps",
    "eps_diluted",
    "operating_margin",
    "net_margin",
    "pe_ratio",
    "earnings_yield",
    "market_cap",
    "fcf_yield",
    "revenue_growth_1y",
    "revenue_growth_3y",
    "net_income_growth_1y",
    "gross_margin",
    "roa",
    "roe",
    "roic",
    "debt_to_equity",
    "accruals_ratio",
    "interest_coverage",
)


def statement_fields_from_reports(
    *,
    income_cur: dict | None,
    income_pri: dict | None,
    income_old: dict | None,
    balance_cur: dict | None,
    cashflow_cur: dict | None,
    growth_cur: dict | None,
    metrics_cur: dict | None,
    price: float | None,
    sector: str | None,
    industry: str | None,
) -> dict[str, Any]:
    """Ratios plus statement totals the screener would have stored."""
    derived = derive_from_reports(
        income_cur=income_cur,
        income_pri=income_pri,
        income_old=income_old,
        balance_cur=balance_cur,
        cashflow_cur=cashflow_cur,
        growth_cur=growth_cur,
        metrics_cur=metrics_cur,
        price=price,
        sector=sector,
        industry=industry,
    )
    inc = income_cur.get("data") if isinstance(income_cur, dict) and isinstance(income_cur.get("data"), dict) else (
        income_cur if isinstance(income_cur, dict) else {}
    )
    if not isinstance(inc, dict):
        inc = {}
    revenue = _f(inc, "revenue")
    ni = _f(inc, "netIncome")
    gp = _f(inc, "grossProfit")
    op = _f(inc, "operatingIncome", "ebit")
    ebitda = _f(inc, "ebitda", "operatingIncome")
    eps = _f(inc, "eps")
    eps_diluted = _f(inc, "epsDiluted", "epsdiluted")
    extra: dict[str, Any] = {}
    if revenue is not None:
        extra["revenue"] = revenue
    if gp is not None:
        extra["gross_profit"] = gp
    if op is not None:
        extra["operating_income"] = op
    if ni is not None:
        extra["net_income"] = ni
    if ebitda is not None:
        extra["ebitda"] = ebitda
    if eps is not None:
        extra["eps"] = eps
    if eps_diluted is not None:
        extra["eps_diluted"] = eps_diluted
    financial = is_financial_sector(sector, industry)
    if not financial and revenue not in (None, 0):
        if op is not None:
            extra["operating_margin"] = round(op / revenue, 4)
        if ni is not None:
            extra["net_margin"] = round(ni / revenue, 4)
    merged = {**extra, **{k: v for k, v in derived.items() if v is not None}}
    return {k: merged[k] for k in _STATEMENT_PATCH_KEYS if k in merged and merged[k] is not None}


def patch_missing_snapshot(
    existing: dict | None,
    incoming: dict,
    *,
    ratios_date: str | None = None,
    source: str = "sec",
) -> dict[str, Any]:
    """Copy only fields the current snapshot does not already have."""
    current = existing or {}
    patch: dict[str, Any] = {}
    for key, value in incoming.items():
        if key not in _STATEMENT_PATCH_KEYS or value is None:
            continue
        if current.get(key) is None:
            patch[key] = value
    if not patch:
        return {}
    if current.get("ratios_date") is None and ratios_date:
        patch["ratios_date"] = ratios_date
    if not current.get("source"):
        patch["source"] = source
    return patch


def _reports_by_symbol(sb, as_of: date) -> dict[str, dict[str, dict]]:
    by: dict[str, dict[str, dict]] = {}
    for rt in ("income", "balance", "cashflow", "growth", "metrics"):
        rows = fetch_all(
            sb,
            "financial_reports",
            "symbol, date, filing_date, data",
            filters=lambda q, report_type=rt: q.eq("report_type", report_type).eq("period", "FY"),
            order=("date", True),
        )
        sym_rows: dict[str, list] = {}
        for r in rows:
            sym_rows.setdefault(r["symbol"], []).append(r)
        for sym, lst in sym_rows.items():
            known = latest_fy_reports_as_of(lst, as_of, max_reports=3)
            if not known:
                continue
            by.setdefault(sym, {})[rt] = known
    return by


def _latest_prices(sb) -> dict[str, float]:
    rows = fetch_all(sb, "prices_daily", "symbol, date, close", order=("date", True))
    px: dict[str, tuple[str, float]] = {}
    for r in rows:
        sym = r["symbol"]
        d = str(r["date"])[:10]
        if sym not in px or d > px[sym][0]:
            px[sym] = (d, float(r["close"] or 0))
    return {s: v[1] for s, v in px.items() if v[1] > 0}


def _statement_rows_by_symbol(sb, as_of: date) -> dict[str, dict[str, list]]:
    by: dict[str, dict[str, list]] = {}
    for rt in ("income", "balance", "cashflow", "growth", "metrics"):
        rows = fetch_all(
            sb,
            "financial_reports",
            "symbol, date, filing_date, data",
            filters=lambda q, report_type=rt: q.eq("report_type", report_type).eq("period", "FY"),
            order=("date", True),
        )
        sym_rows: dict[str, list] = {}
        for r in rows:
            sym_rows.setdefault(r["symbol"], []).append(r)
        for sym, lst in sym_rows.items():
            known = latest_fy_rows_as_of(lst, as_of, max_reports=3)
            if not known:
                continue
            by.setdefault(sym, {})[rt] = known
    return by


def _ratios_date_from_income(row: dict | None) -> str | None:
    if not row:
        return None
    raw = row.get("filing_date") or row.get("date")
    if not raw:
        return None
    return str(raw)[:10]


def fill_missing_from_statements(sb) -> int:
    """Patch null fundamentals_snapshot fields from financial_reports already stored.

    Does not overwrite a value the screener (or a prior run) already wrote.
    """
    as_of = date.today()
    universe = fetch_all(
        sb,
        "universe_members",
        "symbol, sector, industry",
        filters=lambda q: q.eq("is_active", True),
    )
    sector_map = {r["symbol"]: (r.get("sector"), r.get("industry")) for r in universe if r.get("symbol")}
    if not sector_map:
        return 0
    columns = ",".join(("symbol", "ratios_date", "source", *_STATEMENT_PATCH_KEYS))
    existing = {
        r["symbol"]: r
        for r in fetch_all(sb, "fundamentals_snapshot", columns)
        if r.get("symbol")
    }
    reports = _statement_rows_by_symbol(sb, as_of)
    prices = _latest_prices(sb)
    updates: list[dict] = []
    now = datetime.now(timezone.utc).isoformat()
    for sym, (sec, ind) in sector_map.items():
        rep = reports.get(sym, {})
        inc = rep.get("income") or []
        try:
            fields = statement_fields_from_reports(
                income_cur=inc[0] if inc else None,
                income_pri=inc[1] if len(inc) > 1 else None,
                income_old=inc[2] if len(inc) > 2 else None,
                balance_cur=(rep.get("balance") or [None])[0],
                cashflow_cur=(rep.get("cashflow") or [None])[0],
                growth_cur=(rep.get("growth") or [None])[0],
                metrics_cur=(rep.get("metrics") or [None])[0],
                price=prices.get(sym),
                sector=sec,
                industry=ind,
            )
        except Exception:
            logger.exception("Statement fill skipped %s", sym)
            continue
        patch = patch_missing_snapshot(
            existing.get(sym),
            fields,
            ratios_date=_ratios_date_from_income(inc[0] if inc else None),
        )
        if not patch:
            continue
        patch["symbol"] = sym
        patch["updated_at"] = now
        updates.append(patch)

    for i in range(0, len(updates), 200):
        batch = updates[i : i + 200]
        sb.table("fundamentals_snapshot").upsert(batch, on_conflict="symbol").execute()
    logger.info("Filled %d fundamentals_snapshot rows from stored statements", len(updates))
    return len(updates)


def run_derived(sb) -> dict[str, int]:
    as_of = date.today()
    universe = fetch_all(
        sb,
        "universe_members",
        "symbol, sector, industry",
        filters=lambda q: q.eq("is_active", True),
    )
    sector_map = {r["symbol"]: (r.get("sector"), r.get("industry")) for r in universe}
    reports = _reports_by_symbol(sb, as_of)
    prices = _latest_prices(sb)

    updates: list[dict] = []
    for sym in sector_map:
        rep = reports.get(sym, {})
        inc = rep.get("income", [])
        sec, ind = sector_map[sym]
        try:
            derived = derive_from_reports(
                income_cur=inc[0] if inc else None,
                income_pri=inc[1] if len(inc) > 1 else None,
                income_old=inc[2] if len(inc) > 2 else None,
                balance_cur=(rep.get("balance") or [None])[0],
                cashflow_cur=(rep.get("cashflow") or [None])[0],
                growth_cur=(rep.get("growth") or [None])[0],
                metrics_cur=(rep.get("metrics") or [None])[0],
                price=prices.get(sym),
                sector=sec,
                industry=ind,
            )
        except Exception:
            logger.exception("Derived ratios skipped %s", sym)
            continue
        if not derived:
            continue
        derived["symbol"] = sym
        derived["updated_at"] = datetime.now(timezone.utc).isoformat()
        updates.append(derived)

    for i in range(0, len(updates), 200):
        batch = updates[i : i + 200]
        sb.table("fundamentals_snapshot").upsert(batch, on_conflict="symbol").execute()

    return {"symbols": len(sector_map), "updated": len(updates)}


def main() -> None:
    from pipeline.utils.run_recorded import run_recorded

    def _run(sb, run) -> None:
        stats = run_derived(sb)
        run.set_row_counts(**stats)
        run.set_headline(f"derived {stats['updated']}/{stats['symbols']}")

    run_recorded("compute.fundamentals_derived", _run)


if __name__ == "__main__":
    main()