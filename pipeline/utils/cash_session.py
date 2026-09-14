"""US cash-equity session helpers (NYSE regular hours).

EOD books (radar, CASH, ROTATE) use the last closed cash session.
Live LSE ticks go to quotes_last via pipeline.ingest.lse_live — not here.
"""
from __future__ import annotations

import os
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
CASH_OPEN = time(9, 30)
CASH_CLOSE = time(16, 0)


def ny_now(now: datetime | None = None) -> datetime:
    if now is None:
        return datetime.now(NY)
    if now.tzinfo is None:
        return now.replace(tzinfo=NY)
    return now.astimezone(NY)


def is_weekday(d: date) -> bool:
    return d.weekday() < 5


def session_state(now: datetime | None = None) -> str:
    """CLOSED_WEEKEND | PRE | RTH | CLOSED_EOD."""
    n = ny_now(now)
    if not is_weekday(n.date()):
        return "CLOSED_WEEKEND"
    t = n.time()
    if t < CASH_OPEN:
        return "PRE"
    if t < CASH_CLOSE:
        return "RTH"
    return "CLOSED_EOD"


def last_closed_session(now: datetime | None = None) -> date:
    """Most recent date whose regular cash session has finished.

    Before 16:00 ET on a weekday, yesterday's session (skipping weekend).
    Does not encode NYSE holidays.
    """
    n = ny_now(now)
    d = n.date()
    if is_weekday(d) and n.time() >= CASH_CLOSE:
        return d
    d = d - timedelta(days=1)
    while not is_weekday(d):
        d = d - timedelta(days=1)
    return d


def lse_is_streaming() -> bool:
    """True only when a live LSE websocket key is configured.

    The PostgREST catalog is still batch. Ticks require LSE_API_KEY and
    ``python -m pipeline.ingest.lse_live``.
    """
    return bool((os.getenv("LSE_API_KEY") or "").strip())
