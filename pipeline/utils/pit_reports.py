from __future__ import annotations

from datetime import date
from typing import Any


def _report_known_on(row: dict) -> date | None:
    fd = row.get("filing_date")
    if fd:
        return date.fromisoformat(str(fd)[:10])
    d = row.get("date")
    if d:
        return date.fromisoformat(str(d)[:10])
    return None


def latest_fy_reports_as_of(
    rows: list[dict],
    as_of: date,
    *,
    max_reports: int = 3,
) -> list[dict]:
    """FY report ``data`` blobs known on or before ``as_of``, newest fiscal period first."""
    eligible: list[tuple[date, date, dict]] = []
    for r in rows:
        known = _report_known_on(r)
        if known is None or known > as_of:
            continue
        fiscal = date.fromisoformat(str(r["date"])[:10])
        eligible.append((fiscal, known, r.get("data") or {}))
    eligible.sort(key=lambda t: (-t[0].toordinal(), -t[1].toordinal()))
    return [data for _, _, data in eligible[:max_reports]]
