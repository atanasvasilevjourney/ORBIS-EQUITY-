"""PostgREST pagination helpers."""
from unittest.mock import MagicMock


def test_fetch_prices_since_pages_past_1000_rows():
    from pipeline.utils.supabase import PAGE_SIZE, fetch_prices_since

    sb = MagicMock()
    calls: list[tuple[int, int]] = []

    def make_execute():
        call_idx = len(calls) - 1
        offset = calls[call_idx][0]
        if call_idx == 0:
            data = [{"symbol": "A", "date": f"2026-01-{i:02d}"} for i in range(1, PAGE_SIZE + 1)]
        elif call_idx == 1:
            data = [{"symbol": "B", "date": "2026-01-01"}]
        else:
            data = []
        resp = MagicMock()
        resp.data = data
        return resp

    query = MagicMock()
    query.select.return_value = query
    query.gte.return_value = query
    query.order.return_value = query

    def range_(start, end):
        calls.append((start, end))
        return MagicMock(execute=make_execute)

    query.range = range_
    sb.table.return_value = query

    rows = fetch_prices_since(sb, "2025-01-01")
    assert len(rows) == PAGE_SIZE + 1
    assert len(calls) == 2
    assert calls[0] == (0, PAGE_SIZE - 1)
    assert calls[1] == (PAGE_SIZE, PAGE_SIZE * 2 - 1)