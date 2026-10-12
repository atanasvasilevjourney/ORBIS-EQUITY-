"""Corporate-action sanity checks on adjusted daily bars."""
from __future__ import annotations

import pandas as pd


def flag_phantom_split_moves(
    ohlcv: pd.DataFrame,
    *,
    max_overnight_move_pct: float = 40.0,
) -> list[str]:
    """Return bar dates where overnight move exceeds threshold (possible unadjusted split)."""
    if ohlcv.empty or len(ohlcv) < 2:
        return []
    close = ohlcv["close"].astype(float)
    ret = (close / close.shift(1) - 1.0).abs() * 100.0
    bad = ret[ret > max_overnight_move_pct].dropna()
    return [idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx) for idx in bad.index]
