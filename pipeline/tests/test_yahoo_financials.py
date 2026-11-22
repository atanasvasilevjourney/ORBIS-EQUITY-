import pandas as pd

from pipeline.clients.yahoo_financials import _frame_to_reports


def test_income_frame_maps_to_lse_shape():
    df = pd.DataFrame(
        {
            pd.Timestamp("2024-09-28"): [100_000.0, 10_000.0],
            pd.Timestamp("2023-09-30"): [90_000.0, 8_000.0],
        },
        index=["Total Revenue", "Net Income"],
    )
    rows = _frame_to_reports("AAPL", "income", df, {"Total Revenue": "revenue", "Net Income": "netIncome"})
    assert len(rows) == 2
    assert rows[0]["data"]["_source"] == "yahoo"
    assert rows[0]["data"]["revenue"] == 100_000.0