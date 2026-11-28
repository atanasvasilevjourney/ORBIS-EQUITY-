from pipeline.compute.f_score import compute_f_score_detail


def test_financial_excludes_gross_margin_and_asset_turnover():
    income_cur = {"netIncome": 100, "revenue": 1000, "weightedAverageShsOutDil": 100}
    income_pri = {"netIncome": 80, "revenue": 900, "weightedAverageShsOutDil": 100}
    balance_cur = {
        "totalAssets": 2000,
        "longTermDebt": 100,
        "totalCurrentAssets": 500,
        "totalCurrentLiabilities": 200,
    }
    balance_pri = {
        "totalAssets": 1800,
        "longTermDebt": 200,
        "totalCurrentAssets": 400,
        "totalCurrentLiabilities": 250,
    }
    cashflow_cur = {"operatingCashFlow": 120}
    detail = compute_f_score_detail(
        income_cur,
        income_pri,
        balance_cur,
        balance_pri,
        cashflow_cur,
        sector="Financials",
        industry="Capital Markets",
    )
    assert detail is not None
    assert detail["components"]["delta_gross_margin"] is False
    assert detail["components"]["delta_asset_turnover"] is False
    assert detail["score"] <= 9