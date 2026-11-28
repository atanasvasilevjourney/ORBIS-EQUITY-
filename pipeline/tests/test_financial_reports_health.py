"""Tests for financial_reports freshness and F-Score degradation helpers."""
from datetime import date, datetime, timezone
from unittest.mock import MagicMock

from pipeline.utils.financial_reports_health import (
    f_score_degradation_allowed,
    is_lse_auth_error,
)


def test_is_lse_auth_error_detects_401():
    assert is_lse_auth_error("401 Client Error: Unauthorized")
    assert is_lse_auth_error(RuntimeError("HTTP 403 Forbidden"))
    assert not is_lse_auth_error("timeout")


def test_f_score_degradation_allows_recent_pipeline_run():
    sb = MagicMock()

    def table_router(name: str):
        tbl = MagicMock()
        if name == "financial_reports":
            tbl.select.return_value = tbl
            tbl.not_.is_.return_value = tbl
            tbl.order.return_value = tbl
            tbl.limit.return_value = tbl
            tbl.execute.return_value = MagicMock(data=[])
        elif name == "fundamentals_snapshot":
            tbl.select.return_value = tbl
            tbl.not_.is_.return_value = tbl
            tbl.limit.return_value = tbl
            tbl.execute.return_value = MagicMock(count=120)
        elif name == "pipeline_runs":
            tbl.select.return_value = tbl
            tbl.eq.return_value = tbl
            tbl.in_.return_value = tbl
            tbl.not_.is_.return_value = tbl
            tbl.order.return_value = tbl
            tbl.limit.return_value = tbl
            tbl.execute.return_value = MagicMock(
                data=[
                    {
                        "finished_at": datetime(2026, 10, 1, tzinfo=timezone.utc).isoformat(),
                        "row_counts": {"scored": 400},
                    }
                ]
            )
        return tbl

    sb.table.side_effect = table_router
    ok, reason = f_score_degradation_allowed(sb, as_of=date(2026, 11, 24))
    assert ok
    assert "400" in reason


def test_f_score_degradation_rejects_when_nothing_fresh():
    sb = MagicMock()

    def table_router(name: str):
        tbl = MagicMock()
        tbl.select.return_value = tbl
        tbl.not_.is_.return_value = tbl
        tbl.order.return_value = tbl
        tbl.limit.return_value = tbl
        tbl.eq.return_value = tbl
        tbl.in_.return_value = tbl
        tbl.execute.return_value = MagicMock(data=[], count=0)
        return tbl

    sb.table.side_effect = table_router
    ok, reason = f_score_degradation_allowed(sb, as_of=date(2026, 11, 24))
    assert not ok
    assert "120 days" in reason