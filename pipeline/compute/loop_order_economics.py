"""Paper LOOP order fill and cost helpers (aligned with pipeline.strategies.costs)."""
from __future__ import annotations

from datetime import date

import pandas as pd

from pipeline.strategies.costs import DEFAULT_LOOP_COSTS, CostModel


def next_session_open(ohlcv: pd.DataFrame | None, after: date) -> tuple[float | None, str]:
    """Next bar open strictly after ``after``; else None and ``eod_close``."""
    if ohlcv is None or ohlcv.empty:
        return None, "eod_close"
    idx = ohlcv.index
    if not isinstance(idx, pd.DatetimeIndex):
        return None, "eod_close"
    ts = pd.Timestamp(after)
    future = ohlcv.index.normalize() > ts
    if not future.any():
        return None, "eod_close"
    row = ohlcv.iloc[int(future.argmax())]
    op = float(row.get("open") or 0)
    if op <= 0:
        return None, "eod_close"
    return op, "next_open"


def order_economics(
    shares: int,
    limit_price: float | None,
    *,
    fill_price: float | None = None,
    fill_mode: str = "eod_close",
    cost: CostModel = DEFAULT_LOOP_COSTS,
) -> dict:
    px = float(fill_price if fill_price is not None else (limit_price or 0))
    notional = abs(int(shares)) * px
    commission = notional * cost.commission_bps / 10_000.0
    slippage = notional * cost.slippage_bps / 10_000.0
    return {
        "fill_price": round(px, 4) if px > 0 else None,
        "fill_mode": fill_mode,
        "commission_usd": round(commission, 4),
        "slippage_usd": round(slippage, 4),
        "cost_usd": round(commission + slippage, 4),
    }
