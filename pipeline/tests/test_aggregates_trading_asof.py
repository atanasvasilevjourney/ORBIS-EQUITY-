"""Aggregates should key daily_brief to the latest price session."""
from datetime import date
from unittest.mock import MagicMock, patch

from pipeline.compute import aggregates


def test_latest_price_session_reads_max_date():
    sb = MagicMock()
    sb.table.return_value.select.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"date": "2026-11-20"}]
    )
    assert aggregates._latest_price_session(sb) == date(2026, 11, 20)