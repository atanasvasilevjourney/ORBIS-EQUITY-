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
