"""US cash-equity session helpers (NYSE regular hours).

KovaView is an EOD / delayed terminal. There is no LSE websocket.
Use these rules so weekday books do not treat a weekend or an
in-progress Friday print as a closed cash session.
"""
from __future__ import annotations

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
    """London Strategic Edge is batch REST + daily candles. Not a live tape."""
    return False
