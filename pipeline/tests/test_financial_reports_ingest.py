"""Financial reports ingest — LSE/Yahoo merge and failure modes."""
from unittest.mock import MagicMock, patch

import pytest

from pipeline.ingest.financial_reports import merge_report_rows, run_financial_reports_ingest


def test_merge_prefers_lse_over_yahoo_same_key():
    yahoo = [
        {
            "symbol": "AAPL",
            "report_type": "income",
            "date": "2024-09-28",
            "period": "FY",
            "data": {"_source": "yahoo", "netIncome": 1},
        }
    ]
    lse = [
        {
            "symbol": "AAPL",
            "report_type": "income",
            "date": "2024-09-28",
            "period": "FY",
            "data": {"_source": "lse", "netIncome": 2},
        }
    ]
    merged = merge_report_rows(lse, yahoo)
    assert len(merged) == 1
    assert merged[0]["data"]["netIncome"] == 2
    assert merged[0]["data"]["_source"] == "lse"


@patch("pipeline.ingest.financial_reports.fetch_yahoo_financials_batch")
@patch("pipeline.ingest.financial_reports.fetch_active_symbols")
@patch("pipeline.ingest.financial_reports.LSEClient")
def test_run_ingest_yahoo_fallback_when_lse_empty(mock_lse, mock_symbols, mock_yahoo):
    mock_symbols.return_value = ["AAPL", "MSFT"]
    inst = mock_lse.return_value
    inst.get_financial_reports.side_effect = RuntimeError("401 Unauthorized")

    mock_yahoo.return_value.rows = [
        {
            "symbol": "AAPL",
            "report_type": "income",
            "date": "2024-09-28",
            "period": "FY",
            "fiscal_year": "2024",
            "data": {"_source": "yahoo", "netIncome": 100},
        }
    ]

    sb = MagicMock()
    sb.table.return_value.upsert.return_value.execute.return_value = None

    result = run_financial_reports_ingest(sb)
    assert result.lse_ok is False
    assert result.yahoo_rows == 1
    assert result.merged_rows == 1
    sb.table.assert_called()