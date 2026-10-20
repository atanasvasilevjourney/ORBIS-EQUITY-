from __future__ import annotations

from datetime import date

import pandas as pd


def bars_as_of(bars: pd.DataFrame, as_of: date) -> pd.DataFrame:
    if "date" in bars.columns:
        d = bars.copy()
        d["date"] = pd.to_datetime(d["date"])
        d = d[d["date"].dt.normalize() <= pd.Timestamp(as_of)]
        return d.sort_values("date")
    frame = bars.sort_index()
    frame = frame[frame.index.normalize() <= pd.Timestamp(as_of)]
    idx_name = frame.index.name or "date"
    return frame.reset_index().rename(columns={idx_name: "date"})
