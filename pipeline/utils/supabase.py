"""Paginated Supabase helpers — avoids PostgREST 1000-row default cap."""
from __future__ import annotations

from typing import Any, Callable

from supabase import Client

PAGE_SIZE = 1000


def fetch_all(
    sb: Client,
    table: str,
    select: str = "*",
    *,
    filters: Callable[[Any], Any] | None = None,
    order: tuple[str, bool] | None = None,
    page_size: int = PAGE_SIZE,
) -> list[dict]:
    """Fetch all rows from a table with automatic pagination."""
    offset = 0
    all_rows: list[dict] = []

    while True:
        query = sb.table(table).select(select)
        if filters:
            query = filters(query)
        if order:
            col, desc = order
            query = query.order(col, desc=desc)
        resp = query.range(offset, offset + page_size - 1).execute()
        rows = resp.data or []
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size

    return all_rows


def fetch_active_symbols(sb: Client) -> list[str]:
    """All active universe symbols (paginated)."""
    rows = fetch_all(
        sb,
        "universe_members",
        "symbol",
        filters=lambda q: q.eq("is_active", True),
        order=("symbol", False),
    )
    return [r["symbol"] for r in rows if r.get("symbol")]
