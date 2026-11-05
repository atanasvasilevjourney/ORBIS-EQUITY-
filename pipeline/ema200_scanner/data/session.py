"""Cash session helpers for intraday EMA200 (NYSE)."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd

NY = ZoneInfo("America/New_York")
SESSION_CLOSE_MIN = 16 * 60


def drop_incomplete_cash_bar(bars: pd.DataFrame, *, now: datetime | None = None) -> pd.DataFrame:
    """Drop today's last intraday bar before 16:00 ET (in-progress session)."""
    if bars.empty:
        return bars
    now = now or datetime.now(NY)
    if now.tzinfo is None:
        now = now.replace(tzinfo=NY)
    else:
        now = now.astimezone(NY)
    last = bars.index[-1]
    last_ts = last.tz_convert(NY) if last.tzinfo else last.tz_localize(NY)
    if last_ts.date() == now.date() and (last_ts.hour * 60 + last_ts.minute) < SESSION_CLOSE_MIN:
        return bars.iloc[:-1].copy()
    return bars
