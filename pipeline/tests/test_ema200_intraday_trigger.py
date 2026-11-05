"""Phase 3 intraday triggers — synthetic merged bars."""
from __future__ import annotations

import pandas as pd

from pipeline.ema200_scanner.signals.intraday_trigger import detect_intraday_triggers, phase3_config


def _cfg(**overrides):
    base = phase3_config({"phase3": {"enabled": True, "require_daily_watchlist": True}, "touch": {"shortlist_atr": 1.5}})
    base.update(overrides)
    return base


def _merged(rows: list[dict]) -> pd.DataFrame:
    idx = pd.DatetimeIndex([r["ts"] for r in rows], tz="America/New_York")
    return pd.DataFrame(
        {
            "close": [r["close"] for r in rows],
            "ema200_daily": [r["ema"] for r in rows],
            "ribbon_dist_atr_daily": [r["dist"] for r in rows],
            "rvol_5m": [r.get("rvol", 1.5) for r in rows],
        },
        index=idx,
    )


def test_at_ribbon_requires_daily_setup():
    m = _merged(
        [
            {"ts": "2026-09-30 09:35:00", "close": 100.0, "ema": 99.0, "dist": 0.4},
            {"ts": "2026-09-30 10:00:00", "close": 100.2, "ema": 99.0, "dist": 0.35},
        ]
    )
    assert detect_intraday_triggers("TEST", m, daily_setup=None, cfg=_cfg(), live_last_bar_only=True) == []


def test_at_ribbon_fires_on_last_bar():
    m = _merged(
        [
            {"ts": "2026-09-30 09:35:00", "close": 100.0, "ema": 99.0, "dist": 0.8},
            {"ts": "2026-09-30 10:00:00", "close": 100.2, "ema": 99.0, "dist": 0.35},
        ]
    )
    hits = detect_intraday_triggers("TEST", m, daily_setup="RETRACE_HELD", cfg=_cfg(), live_last_bar_only=True)
    assert len(hits) == 1
    assert hits[0].trigger_type == "INTRADAY_AT_RIBBON"


def test_reclaim_requires_retrace_held():
    m = _merged(
        [
            {"ts": "2026-09-30 09:35:00", "close": 98.5, "ema": 99.0, "dist": 2.0},
            {"ts": "2026-09-30 10:00:00", "close": 100.2, "ema": 99.0, "dist": 0.35},
        ]
    )
    hits = detect_intraday_triggers("TEST", m, daily_setup="APPROACHING", cfg=_cfg(), live_last_bar_only=True)
    assert not any(t.trigger_type == "INTRADAY_RECLAIM" for t in hits)


def test_reclaim_prefers_over_at_ribbon():
    m = _merged(
        [
            {"ts": "2026-09-30 09:35:00", "close": 98.5, "ema": 99.0, "dist": 2.0},
            {"ts": "2026-09-30 10:00:00", "close": 100.2, "ema": 99.0, "dist": 0.35},
        ]
    )
    hits = detect_intraday_triggers("TEST", m, daily_setup="RETRACE_HELD", cfg=_cfg(), live_last_bar_only=True)
    assert len(hits) == 1
    assert hits[0].trigger_type == "INTRADAY_RECLAIM"
