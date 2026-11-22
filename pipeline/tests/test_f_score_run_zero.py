"""F-Score job must fail when it scores zero names."""
from unittest.mock import MagicMock, patch

import pytest

from pipeline.compute import f_score


@patch("pipeline.compute.f_score._fetch_all_reports")
def test_run_f_score_exits_when_zero_scored(mock_fetch):
    mock_fetch.side_effect = [{}, {}, {}]
    sb = MagicMock()
    sb.table.return_value.upsert.return_value.execute.return_value = None

    run = MagicMock()
    with patch(
        "pipeline.utils.supabase.fetch_all",
        return_value=[{"symbol": "AAPL"}, {"symbol": "MSFT"}],
    ):
        with pytest.raises(SystemExit) as exc:
            f_score._run_f_score(sb, run)
    assert exc.value.code == 1
    run.mark_partial.assert_called_with("zero scores")