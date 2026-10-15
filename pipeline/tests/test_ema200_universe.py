"""EMA200 scanner universe = S&P 500 ∪ Nasdaq-100."""
from unittest.mock import MagicMock, patch

from pipeline.ema200_scanner.data.universe import sync_ema200_universe


@patch("pipeline.ema200_scanner.data.universe.sp500_nasdaq100_stocks")
@patch("pipeline.ema200_scanner.data.universe.fetch_all")
def test_sync_sp500_ndx100(mock_fetch_all, mock_spndx):
    mock_spndx.return_value = (
        [
            {"symbol": "AAPL", "tier": "us_large", "exchange": "NASDAQ"},
            {"symbol": "DDOG", "tier": "us_nasdaq100", "exchange": "NASDAQ"},
        ],
        {"merged": 2},
    )
    mock_fetch_all.return_value = [{"symbol": "OLD"}]

    sb = MagicMock()
    table = MagicMock()
    sb.table.return_value = table
    upsert = MagicMock()
    update = MagicMock()
    table.upsert.return_value = upsert
    upsert.execute.return_value = None
    table.update.return_value = update
    update.in_.return_value = update
    update.execute.return_value = None

    rows = sync_ema200_universe(sb)
    assert len(rows) == 3
    assert rows[0]["index_tag"] == "sp500"
    assert rows[1]["index_tag"] == "ndx100"
    supp = [r for r in rows if r["index_tag"] == "supplement"]
    assert any(r["symbol"] == "NBIS" for r in supp)
    sb.table.assert_any_call("ema200_universe")
