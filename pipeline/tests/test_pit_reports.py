from __future__ import annotations

from datetime import date

from pipeline.utils.pit_reports import latest_fy_reports_as_of


def test_filing_date_gates_availability():
    rows = [
        {
            "date": "2024-12-31",
            "filing_date": "2025-03-01",
            "data": {"x": 1},
        },
        {
            "date": "2023-12-31",
            "filing_date": "2024-03-01",
            "data": {"x": 0},
        },
    ]
    feb = latest_fy_reports_as_of(rows, date(2025, 2, 1))
    assert len(feb) == 1 and feb[0]["x"] == 0
    got = latest_fy_reports_as_of(rows, date(2025, 3, 2))
    assert got[0]["x"] == 1


def test_missing_filing_date_uses_annual_lag():
    rows = [
        {"date": "2024-12-31", "filing_date": None, "data": {"x": 1}},
    ]
    # Period end alone would have leaked this report on the first session of January.
    assert latest_fy_reports_as_of(rows, date(2025, 1, 2)) == []
    # 2024-12-31 + 90 days = 2025-03-31.
    assert latest_fy_reports_as_of(rows, date(2025, 3, 30)) == []
    got = latest_fy_reports_as_of(rows, date(2025, 3, 31))
    assert len(got) == 1 and got[0]["x"] == 1
