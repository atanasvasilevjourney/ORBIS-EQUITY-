"""F-Score job zero-score handling: fail or degrade to prior snapshot."""
from unittest.mock import MagicMock, patch

import pytest

from pipeline.compute import f_score


@patch(
    "pipeline.utils.financial_reports_health.f_score_degradation_allowed",
    return_value=(False, "stale"),
)
@patch("pipeline.utils.financial_reports_health.count_financial_report_rows", return_value=0)
@patch("pipeline.utils.financial_reports_health.financial_reports_latest_known_on", return_value=None)
@patch("pipeline.compute.f_score._fetch_all_reports")
def test_run_f_score_exits_when_zero_scored_and_no_snapshot(
    mock_fetch, _known, _count, _degrade
):
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


@patch(
    "pipeline.utils.financial_reports_health.f_score_degradation_allowed",
    return_value=(True, "prior run"),
)
@patch("pipeline.utils.financial_reports_health.count_financial_report_rows", return_value=0)
@patch("pipeline.utils.financial_reports_health.financial_reports_latest_known_on", return_value=None)
@patch("pipeline.compute.f_score._fetch_all_reports")
def test_run_f_score_degrades_when_prior_snapshot_fresh(
    mock_fetch, _known, _count, _degrade
):
    mock_fetch.side_effect = [{}, {}, {}]
    sb = MagicMock()
    run = MagicMock()
    with patch(
        "pipeline.utils.supabase.fetch_all",
        return_value=[{"symbol": "AAPL"}],
    ):
        f_score._run_f_score(sb, run)
    run.mark_partial.assert_called_with("degraded: reused prior F-Score snapshot")