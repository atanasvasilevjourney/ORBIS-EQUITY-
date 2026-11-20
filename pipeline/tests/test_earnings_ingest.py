from unittest.mock import MagicMock, patch

import pytest

from pipeline.clients.yahoo_earnings import YahooEarningsBatchResult
from pipeline.ingest.earnings import EarningsIngestResult, main, run_earnings_ingest


def test_run_earnings_exits_nonzero_when_empty(monkeypatch):
    monkeypatch.setattr(
        "pipeline.ingest.earnings.run_earnings_ingest",
        lambda sb=None: EarningsIngestResult(
            lse_ok=False,
            lse_rows=0,
            yahoo_symbols=10,
            yahoo_rows=0,
            merged_rows=0,
            upserted=0,
        ),
    )
    with pytest.raises(SystemExit) as exc:
        main()
    assert exc.value.code == 1


@patch("pipeline.ingest.earnings.fetch_yahoo_earnings_batch")
@patch("pipeline.ingest.earnings.LSEClient")
@patch("pipeline.ingest.earnings.fetch_research_desk_symbols", return_value=["AAPL", "MSFT"])
def test_run_earnings_yahoo_gap_fill(mock_syms, mock_lse_cls, mock_yahoo):
    mock_lse = MagicMock()
    mock_lse.get_earnings.return_value = [
        {"symbol": "AAPL", "event_date": "2025-10-30", "eps_estimated": 1.0, "eps_actual": 1.1},
    ]
    mock_lse_cls.return_value = mock_lse
    mock_yahoo.return_value = YahooEarningsBatchResult(
        rows=[
            {
                "ticker": "MSFT",
                "event_date": "2025-11-01",
                "confirmed": False,
                "source": "yahoo",
                "eps_est": 2.0,
                "eps_actual": None,
                "surprise_pct": None,
                "revenue_est": None,
                "revenue_actual": None,
            }
        ],
        symbols_ok=1,
        symbols_failed=0,
    )

    sb = MagicMock()
    table = MagicMock()
    table.upsert.return_value = table
    table.execute.return_value = MagicMock(data=[])
    sb.table.return_value = table

    result = run_earnings_ingest(sb)
    assert result.upserted == 2
    mock_yahoo.assert_called_once()
    called_symbols = mock_yahoo.call_args[0][0]
    assert called_symbols == ["MSFT"]