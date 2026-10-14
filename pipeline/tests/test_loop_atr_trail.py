"""LOOP production ATR trail helpers."""
from datetime import date

import pandas as pd

from pipeline.compute.loop_atr_trail import atr_trail_exit_signal, chandelier_trail_snapshot


def _ohlcv(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows)


def test_chandelier_ratchets_and_triggers_exit():
    # 20 bars flat then rally then pullback
    rows = []
    for i in range(25):
        c = 100.0 + (5.0 if i >= 15 else 0.0) - (8.0 if i >= 22 else 0.0)
        rows.append({
            "date": f"2026-01-{i+1:02d}",
            "open": c,
            "high": c + 1,
            "low": c - 1,
            "close": c,
            "volume": 1_000_000,
        })
    df = _ohlcv(rows)
    opened = date(2026, 1, 1)
    snap = chandelier_trail_snapshot(df, entry_price=100.0, opened=opened, asof=date(2026, 1, 25))
    assert snap is not None
    assert snap.peak_price >= 105.0
    hit, reason, _ = atr_trail_exit_signal(
        df, entry_price=100.0, opened=opened, asof=date(2026, 1, 23),
    )
    assert hit is True
    assert reason is not None
    assert "ATR(14)" in reason
