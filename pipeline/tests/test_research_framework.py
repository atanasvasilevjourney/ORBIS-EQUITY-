"""Unit tests for weekly research pack rules."""
from __future__ import annotations

import numpy as np

from pipeline.research_framework.rules import (
    build_breakout_setup,
    build_macro_view,
    load_config,
    orbis_score,
    rank_setups,
    score_candidate,
    theme_bucket,
    week_start_for,
)
from datetime import date


def test_load_config_has_setups():
    cfg = load_config()
    assert cfg["setups"]["max_count"] == 5
    assert cfg["macro"]["benchmarks"][0]["symbol"] == "SPY"


def test_orbis_score_blend():
    assert orbis_score(80, 60) == 72
    assert orbis_score(None, 50) == 50


def test_week_start_monday():
    assert week_start_for(date(2026, 10, 15)).isoformat() == "2026-10-12"


def test_theme_bucket_semis():
    themes = {"semis": {"match_sectors": ["Semiconductors"]}, "default_bucket": "general"}
    assert theme_bucket("Semiconductors", themes) == "semis"
    assert theme_bucket("Retail", themes) == "general"


def test_build_macro_view_above_ma200():
    n = 260
    close = np.linspace(100, 150, n)
    high = close + 1
    low = close - 1
    view = build_macro_view(close, high, low, symbol="SPY", label="S&P 500")
    assert view is not None
    assert view["regime"] == "above_MA200"
    assert view["distMa200Pct"] is not None


def test_breakout_setup_rr():
    n = 80
    close = np.full(n, 100.0)
    close[-1] = 101.0
    high = close + 2
    high[-1] = 105.0
    low = close - 2
    setup = build_breakout_setup(
        close, high, low, stop_atr_mult=0.75, target_atr_mult=1.5, min_rr=1.0
    )
    assert setup is not None
    assert setup["side"] == "LONG"
    assert setup["status"] == "pending"
    assert setup["entry"] == setup["entry"]  # typed
    assert setup["rr"] >= 1.0


def test_score_candidate_filters_green():
    cfg = {"min_orbis_score": 70, "min_quality_rank": 55, "require_radar_green": True}
    radar = {"state": 1, "quality_rank": 80}
    fund = {"composite_factor_score": 70}
    score, ok = score_candidate(radar, fund, cfg)
    assert ok and score is not None and score >= 70

    radar_bad = {"state": 0, "quality_rank": 90}
    _, ok2 = score_candidate(radar_bad, fund, cfg)
    assert not ok2


def test_rank_setups_cap():
    rows = [{"symbol": "A", "orbis_score": 90, "quality_rank": 80}, {"symbol": "B", "orbis_score": 85, "quality_rank": 70}]
    ranked = rank_setups(rows, 1)
    assert len(ranked) == 1
    assert ranked[0]["rank"] == 1
    assert ranked[0]["symbol"] == "A"
