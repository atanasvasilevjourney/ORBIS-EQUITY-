"""SEC EDGAR XBRL mapping tests (fixtures only — no live SEC in CI)."""
from pathlib import Path

import pytest

from pipeline.clients.sec_edgar import (
    companyfacts_to_report_rows,
    load_companyfacts_fixture,
    resolve_cik,
)
from pipeline.clients.sec_xbrl_map import F_SCORE_FIELD_TAGS, score_f_score_readiness
from pipeline.compute.f_score import compute_f_score_detail

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "sec"


@pytest.fixture
def ticker_index():
    import json

    with (FIXTURES / "company_tickers_sample.json").open(encoding="utf-8") as f:
        raw = json.load(f)
    from pipeline.clients.sec_edgar import _parse_ticker_index

    return _parse_ticker_index(raw)


def test_resolve_cik_handles_class_shares(ticker_index):
    assert resolve_cik("AAPL", ticker_index) == 320193
    assert resolve_cik("BF-B", ticker_index) == 1467858


def test_aapl_fixture_produces_fy_rows_and_f_score():
    facts = load_companyfacts_fixture(FIXTURES / "AAPL_companyfacts.json")
    rows = companyfacts_to_report_rows("AAPL", facts, cik=320193, max_fy=3)
    assert len(rows) >= 6
    assert all(r["data"]["_source"] == "sec" for r in rows)

    by_type: dict[str, list[dict]] = {}
    for r in rows:
        by_type.setdefault(r["report_type"], []).append(r)
    for rt in ("income", "balance", "cashflow"):
        assert rt in by_type

    income = sorted(by_type["income"], key=lambda r: r["date"], reverse=True)
    balance = sorted(by_type["balance"], key=lambda r: r["date"], reverse=True)
    cashflow = sorted(by_type["cashflow"], key=lambda r: r["date"], reverse=True)

    detail = compute_f_score_detail(
        income[0]["data"],
        income[1]["data"] if len(income) > 1 else None,
        balance[0]["data"],
        balance[1]["data"] if len(balance) > 1 else None,
        cashflow[0]["data"] if cashflow else None,
        balance[2]["data"] if len(balance) > 2 else None,
    )
    assert detail is not None
    assert 0 <= detail["score"] <= 9


def test_msft_fixture_has_net_income_and_assets():
    facts = load_companyfacts_fixture(FIXTURES / "MSFT_companyfacts.json")
    rows = companyfacts_to_report_rows("MSFT", facts, cik=789019, max_fy=2)
    income = [r for r in rows if r["report_type"] == "income"][0]["data"]
    balance = [r for r in rows if r["report_type"] == "balance"][0]["data"]
    assert income.get("netIncome") is not None
    assert balance.get("totalAssets") is not None


def test_bf_b_reports_long_term_debt_may_be_missing():
    facts = load_companyfacts_fixture(FIXTURES / "BF_B_companyfacts.json")
    rows = companyfacts_to_report_rows("BF-B", facts, cik=1467858, max_fy=1)
    by_type = {r["report_type"]: r["data"] for r in rows}
    _, missing = score_f_score_readiness(
        by_type.get("income"),
        by_type.get("balance"),
        by_type.get("cashflow"),
    )
    # Brown-Forman fixture may omit longTermDebt in us-gaap slice
    if "longTermDebt" in missing:
        assert "longTermDebt" in F_SCORE_FIELD_TAGS