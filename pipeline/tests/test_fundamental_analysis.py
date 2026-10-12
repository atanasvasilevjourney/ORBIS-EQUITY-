"""Tests for statement-derived fundamental analysis."""
from pipeline.compute.fundamental_analysis import build_fundamental_analysis
from pipeline.compute.f_score import compute_f_score, compute_f_score_detail


def test_strong_verdict():
    a = build_fundamental_analysis(
        f_score=8,
        composite_factor_score=80,
        value_score=75,
        quality_score=82,
        growth_score=60,
        earnings_quality_score=70,
        leverage_score=65,
        roe=0.22,
        net_margin=0.18,
        revenue_growth_1y=0.12,
        accruals_ratio=0.03,
        interest_coverage=12.0,
    )
    assert a.verdict in ("STRONG", "ATTRACTIVE")
    assert a.score_hint is not None and a.score_hint >= 60
    assert "F-Score" in a.summary


def test_distressed_verdict():
    a = build_fundamental_analysis(
        f_score=1,
        composite_factor_score=15,
        quality_score=10,
        earnings_quality_score=20,
        leverage_score=15,
        accruals_ratio=-0.05,
        interest_coverage=0.8,
    )
    assert a.verdict == "DISTRESSED"


def test_insufficient_without_scores():
    a = build_fundamental_analysis(f_score=None, composite_factor_score=None)
    assert a.verdict == "INSUFFICIENT"


def test_f_score_detail_matches_score(strong_f_score_data):
    d = strong_f_score_data
    detail = compute_f_score_detail(
        d["income_cur"], d["income_pri"],
        d["balance_cur"], d["balance_pri"],
        d["cashflow_cur"],
    )
    score = compute_f_score(
        d["income_cur"], d["income_pri"],
        d["balance_cur"], d["balance_pri"],
        d["cashflow_cur"],
    )
    assert detail is not None
    assert detail["score"] == score
    assert sum(1 for v in detail["components"].values() if v) == score
    assert "profitability" in detail["groups"]
