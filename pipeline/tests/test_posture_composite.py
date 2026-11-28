import math

import numpy as np
import pandas as pd

from pipeline.compute.posture_composite import (
    build_price_frames,
    composite_score,
    highs_lows_pillar,
    posture_label,
    risk_pillar,
    vix_level_score,
)


def test_vix_level_score_mapping():
    assert vix_level_score(14) >= 80
    assert vix_level_score(30) <= 30
    assert vix_level_score(None) == 50


def test_risk_off_caps_label():
    assert posture_label(72, risk_off=True) == "Neutral"


def test_composite_weights_sum_to_score():
    pillars = {"breadth": 80, "trend": 60, "index_trend": 70, "highs_lows": 50, "risk": 40}
    score = composite_score(pillars)
    assert 0 <= score <= 100


def test_highs_lows_pillar_net():
    assert highs_lows_pillar(10, 2) > highs_lows_pillar(2, 10)


def test_build_frames_groups_symbols():
    rows = [
        {"symbol": "A", "date": "2026-01-01", "close": 1},
        {"symbol": "A", "date": "2026-01-02", "close": 2},
        {"symbol": "B", "date": "2026-01-01", "close": 3},
    ]
    frames = build_price_frames(rows)
    assert list(frames.keys()) == ["A", "B"]
    assert len(frames["A"]) == 2


def test_risk_pillar_backwardation_lowers_score():
    base, _ = risk_pillar(20.0, 18.0, None)
    stressed, risk_off = risk_pillar(28.0, 22.0, None)
    assert stressed <= base
    assert risk_off