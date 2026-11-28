"""Financial reports ingest — SEC/Yahoo/LSE merge and failure modes."""
from unittest.mock import MagicMock, patch

import pytest

from pipeline.clients.sec_edgar import SecFinancialsBatchResult
from pipeline.ingest.financial_reports import merge_report_rows, run_financial_reports_ingest


def _core_row(symbol: str, report_type: str, source: str, net: float = 1.0) -> dict:
    data = {"_source": source, "netIncome": net}
    if report_type == "balance":
        data = {"_source": source, "totalAssets": net}
    if report_type == "cashflow":
        data = {"_source": source, "operatingCashFlow": net}
    return {
        "symbol": symbol,
        "report_type": report_type,
        "date": "2024-09-28",
        "period": "FY",
        "data": data,
    }


def test_merge_prefers_sec_over_yahoo_and_lse():
    yahoo = [_core_row("AAPL", "income", "yahoo", 1)]
    lse = [_core_row("AAPL", "income", "lse", 2)]
    sec = [_core_row("AAPL", "income", "sec", 3)]
    merged = merge_report_rows(sec, yahoo, lse)
    assert len(merged) == 1
    assert merged[0]["data"]["netIncome"] == 3
    assert merged[0]["data"]["_source"] == "sec"


def _empty_sec():
    return SecFinancialsBatchResult([], 0, 0, 0, 0, 0, 0, {})


@patch.dict("os.environ", {"LSE_API_KEY": "test-key"})
@patch("pipeline.ingest.financial_reports.load_company_tickers", return_value={})
@patch("pipeline.ingest.financial_reports.fetch_sec_financials_batch", return_value=_empty_sec())
@patch("pipeline.ingest.financial_reports.fetch_yahoo_financials_batch")
@patch("pipeline.ingest.financial_reports.fetch_active_symbols")
@patch("pipeline.ingest.financial_reports.LSEClient")
def test_run_ingest_yahoo_fallback_when_sec_empty(mock_lse, mock_symbols, mock_yahoo, *_):
    mock_symbols.return_value = ["AAPL", "MSFT"]
    inst = mock_lse.return_value
    inst.get_financial_reports.side_effect = RuntimeError("401 Unauthorized")

    mock_yahoo.return_value.rows = [
        _core_row("AAPL", "income", "yahoo", 100),
        _core_row("AAPL", "balance", "yahoo", 100),
        _core_row("AAPL", "cashflow", "yahoo", 100),
    ]

    sb = MagicMock()
    sb.table.return_value.upsert.return_value.execute.return_value = None

    result = run_financial_reports_ingest(sb)
    assert result.lse_ok is False
    assert result.yahoo_rows == 3
    assert result.merged_rows == 3
    sb.table.assert_called()


@patch.dict("os.environ", {"LSE_API_KEY": "test-key"})
@patch("pipeline.ingest.financial_reports.gh_warning")
@patch("pipeline.ingest.financial_reports.load_company_tickers", return_value={})
@patch("pipeline.ingest.financial_reports.fetch_sec_financials_batch", return_value=_empty_sec())
@patch("pipeline.ingest.financial_reports.fetch_yahoo_financials_batch")
@patch("pipeline.ingest.financial_reports.fetch_active_symbols")
@patch("pipeline.ingest.financial_reports.LSEClient")
def test_run_ingest_lse_401_logs_warning_only(
    mock_lse, mock_symbols, mock_yahoo, mock_sec, mock_tickers, mock_warn
):
    mock_symbols.return_value = ["AAPL"]
    inst = mock_lse.return_value
    inst.get_financial_reports.side_effect = RuntimeError("401 Unauthorized")

    mock_yahoo.return_value.rows = [
        _core_row("AAPL", "income", "yahoo", 100),
        _core_row("AAPL", "balance", "yahoo", 100),
        _core_row("AAPL", "cashflow", "yahoo", 100),
    ]
    sb = MagicMock()
    sb.table.return_value.upsert.return_value.execute.return_value = None

    result = run_financial_reports_ingest(sb)
    assert result.upserted == 3
    assert mock_warn.called
    assert any("LSE_API_KEY" in str(c.args[0]) for c in mock_warn.call_args_list)


@patch("pipeline.ingest.financial_reports.gh_error")
@patch("pipeline.ingest.financial_reports.run_financial_reports_ingest")
def test_main_exits_when_zero_rows(mock_run, mock_err):
    from pipeline.ingest import financial_reports as mod

    mock_run.return_value = mod.FinancialReportsIngestResult(
        sec_rows=0,
        sec_symbols_ok=0,
        sec_symbols_no_cik=0,
        sec_coverage_full=0,
        lse_ok=False,
        lse_rows=0,
        yahoo_symbols=2,
        yahoo_rows=0,
        merged_rows=0,
        upserted=0,
        lse_error=None,
    )
    with pytest.raises(SystemExit) as exc:
        mod.main()
    assert exc.value.code == 1
    assert mock_err.called