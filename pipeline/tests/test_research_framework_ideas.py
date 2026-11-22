import numpy as np

from pipeline.research_framework.ideas import (
    build_idea,
    ideas_by_horizon,
    rank_short_candidates,
    short_rules,
)
from pipeline.research_framework.levels import short_setup_from_bars


def test_short_setup_breakdown_prior_low():
    n = 30
    close = np.linspace(110, 100, n)
    high = close + 1
    low = close - 1
    out = short_setup_from_bars(high, low, close, entry_mode="breakdown_prior_low")
    assert out is not None
    assert out["stop_px"] > out["entry_px"] > out["target_px"]
    assert out["rr"] > 0


def test_short_rules_require_min_count():
    cfg = {"max_composite_factor_short": 48, "short_min_rules": 2}
    rules, sources, ok = short_rules(
        "XYZ",
        radar={"state": -1},
        fund={"composite_factor_score": 60},
        analysis={"vote": "HOLD"},
        carver_fc=None,
        rotate_fc=None,
        cfg=cfg,
    )
    assert not ok
    assert "trend_radar_red" in rules

    rules2, _, ok2 = short_rules(
        "XYZ",
        radar={"state": -1},
        fund={"composite_factor_score": 40},
        analysis={"vote": "SELL"},
        carver_fc=-1.5,
        rotate_fc=None,
        cfg=cfg,
    )
    assert ok2
    assert len(rules2) >= 2


def test_rank_short_candidates_orders_by_rules():
    cfg = {
        "max_trend_radar_quality_short": 60,
        "max_composite_factor_short": 48,
        "short_min_rules": 2,
        "short_candidate_pool": 10,
    }
    radar = {
        "AAA": {"state": -1, "quality_rank": 30},
        "BBB": {"state": 0, "quality_rank": 20},
    }
    fund = {
        "AAA": {"composite_factor_score": 40},
        "BBB": {"composite_factor_score": 35},
    }
    analysis = {"AAA": {"vote": "SELL"}, "BBB": {"vote": "SELL"}}
    ranked = rank_short_candidates(radar, fund, analysis, {"BBB": -2.0}, {}, cfg)
    symbols = [r["symbol"] for r in ranked]
    assert "AAA" in symbols
    assert "BBB" in symbols


def test_build_idea_evidence_meta():
    idea = build_idea(
        symbol="TST",
        direction="SHORT",
        horizon="short_term",
        levels={"entry_px": 10, "stop_px": 11, "target_px": 8, "last_px": 10.2, "rr": 2, "atr": 0.5},
        company_name="Test",
        theme="tech",
        rationale="r",
        sources=["trend_radar"],
        wrong_test="w",
        rules=["trend_radar_red", "analyze_sell_vote"],
        rank_score=1.0,
    )
    assert idea["meta"]["evidence"]["ticker"] == "SOURCED"
    assert idea["meta"]["evidence"]["wrong_test"] == "ASSUMED"
    assert idea["entry_zone"][0] <= idea["entry_px"] <= idea["entry_zone"][1]
    buckets = ideas_by_horizon([idea])
    assert len(buckets["short_term"]) == 1