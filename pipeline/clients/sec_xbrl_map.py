"""us-gaap tag fallbacks mapped to Orbis ``financial_reports.data`` keys (F-Score)."""
from __future__ import annotations

from typing import Any

# Each logical field: ordered XBRL tag candidates (first present wins per fiscal period).
F_SCORE_FIELD_TAGS: dict[str, list[str]] = {
    "netIncome": [
        "NetIncomeLoss",
        "ProfitLoss",
        "NetIncomeLossAvailableToCommonStockholdersBasic",
    ],
    "revenue": [
        "Revenues",
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "SalesRevenueNet",
    ],
    "grossProfit": ["GrossProfit"],
    "weightedAverageShsOut": [
        "WeightedAverageNumberOfSharesOutstandingBasic",
        "WeightedAverageNumberOfShareOutstandingBasicAndDiluted",
    ],
    "weightedAverageShsOutDil": [
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "WeightedAverageNumberOfSharesOutstandingBasic",
    ],
    "totalAssets": ["Assets"],
    "totalCurrentAssets": ["AssetsCurrent"],
    "totalCurrentLiabilities": ["LiabilitiesCurrent"],
    "longTermDebt": [
        "LongTermDebtNoncurrent",
        "LongTermDebt",
        "LongTermDebtAndCapitalLeaseObligations",
    ],
    "operatingCashFlow": [
        "NetCashProvidedByUsedInOperatingActivities",
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
}

INCOME_FIELDS = [
    "netIncome",
    "revenue",
    "grossProfit",
    "weightedAverageShsOut",
    "weightedAverageShsOutDil",
]
BALANCE_FIELDS = [
    "totalAssets",
    "totalCurrentAssets",
    "totalCurrentLiabilities",
    "longTermDebt",
]
CASHFLOW_FIELDS = ["operatingCashFlow"]

FY_FORMS = frozenset({"10-K", "20-F", "40-F", "10-K/A"})
Q_FORMS = frozenset({"10-Q", "10-Q/A"})


def _first_unit_series(tag_blob: dict[str, Any]) -> list[dict]:
    units = tag_blob.get("units") or {}
    for key in ("USD", "usd", "USD/shares", "shares"):
        if key in units:
            return list(units[key])
    if units:
        return list(next(iter(units.values())))
    return []


def _pick_value(
    us_gaap: dict[str, Any],
    tag_names: list[str],
    *,
    end: str,
    fp: str | None = None,
    forms: frozenset[str] | None = None,
) -> float | None:
    for tag in tag_names:
        blob = us_gaap.get(tag)
        if not blob:
            continue
        for pt in _first_unit_series(blob):
            if str(pt.get("end"))[:10] != end[:10]:
                continue
            if fp is not None and pt.get("fp") != fp:
                continue
            if forms is not None and pt.get("form") not in forms:
                continue
            val = pt.get("val")
            if val is not None:
                try:
                    return float(val)
                except (TypeError, ValueError):
                    continue
    return None


def list_fy_period_ends(us_gaap: dict[str, Any], *, max_periods: int = 3) -> list[dict]:
    """Distinct annual FY period ends (10-K / 20-F), newest first."""
    anchors = F_SCORE_FIELD_TAGS["netIncome"] + F_SCORE_FIELD_TAGS["revenue"]
    seen: dict[str, dict] = {}
    for tag in anchors:
        blob = us_gaap.get(tag)
        if not blob:
            continue
        for pt in _first_unit_series(blob):
            if pt.get("fp") != "FY":
                continue
            form = pt.get("form") or ""
            if form not in FY_FORMS and not form.startswith("10-K"):
                continue
            end = pt.get("end")
            if not end:
                continue
            key = str(end)[:10]
            filed = pt.get("filed") or ""
            prev = seen.get(key)
            if prev is None or filed > prev.get("filed", ""):
                seen[key] = {
                    "end": key,
                    "fy": pt.get("fy"),
                    "filed": filed,
                    "form": form,
                }
    periods = sorted(seen.values(), key=lambda p: p["end"], reverse=True)
    return periods[:max_periods]


def build_field_dict(
    us_gaap: dict[str, Any],
    fields: list[str],
    *,
    end: str,
) -> dict[str, Any]:
    out: dict[str, Any] = {"_source": "sec"}
    for field in fields:
        tags = F_SCORE_FIELD_TAGS.get(field, [])
        val = _pick_value(us_gaap, tags, end=end, fp="FY", forms=FY_FORMS)
        if val is None:
            val = _pick_value(us_gaap, tags, end=end, fp="FY")
        if val is not None:
            out[field] = val
    return out


def f_score_coverage(data: dict[str, Any]) -> dict[str, bool]:
    """Whether each F-Score input field is present on a merged symbol set."""
    required = list(F_SCORE_FIELD_TAGS.keys())
    return {k: data.get(k) is not None for k in required}


def score_f_score_readiness(
    income: dict | None,
    balance: dict | None,
    cashflow: dict | None,
) -> tuple[int, list[str]]:
    """Returns (fields_present, missing_field_names)."""
    merged: dict[str, Any] = {}
    for blob in (income, balance, cashflow):
        if blob:
            merged.update({k: v for k, v in blob.items() if k != "_source"})
    cov = f_score_coverage(merged)
    missing = [k for k, ok in cov.items() if not ok]
    return len(cov) - len(missing), missing