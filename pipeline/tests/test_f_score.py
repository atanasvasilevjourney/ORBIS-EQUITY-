"""Unit tests for pipeline.compute.f_score Piotroski scoring."""
from pipeline.compute.f_score import compute_f_score, _safe_div


class TestSafeDiv:
    def test_normal_division(self):
        assert _safe_div(10, 2) == 5.0

    def test_zero_denominator(self):
        assert _safe_div(10, 0) is None

    def test_none_operand(self):
        assert _safe_div(None, 5) is None
        assert _safe_div(5, None) is None


class TestComputeFScore:
    def test_missing_current_data_returns_none(self, strong_f_score_data):
        d = strong_f_score_data
        assert compute_f_score(None, d["income_pri"], d["balance_cur"], d["balance_pri"], d["cashflow_cur"]) is None
        assert compute_f_score(d["income_cur"], d["income_pri"], None, d["balance_pri"], d["cashflow_cur"]) is None

    def test_missing_prior_data_returns_none(self, strong_f_score_data):
        d = strong_f_score_data
        assert compute_f_score(d["income_cur"], None, d["balance_cur"], d["balance_pri"], d["cashflow_cur"]) is None

    def test_strong_company_high_score(self, strong_f_score_data):
        d = strong_f_score_data
        score = compute_f_score(
            d["income_cur"], d["income_pri"],
            d["balance_cur"], d["balance_pri"],
            d["cashflow_cur"],
        )
        assert score is not None
        assert score >= 7

    def test_weak_company_low_score(self, weak_f_score_data):
        d = weak_f_score_data
        score = compute_f_score(
            d["income_cur"], d["income_pri"],
            d["balance_cur"], d["balance_pri"],
            d["cashflow_cur"],
        )
        assert score is not None
        assert score <= 3

    def test_score_in_valid_range(self, strong_f_score_data):
        d = strong_f_score_data
        score = compute_f_score(
            d["income_cur"], d["income_pri"],
            d["balance_cur"], d["balance_pri"],
            d["cashflow_cur"],
        )
        assert 0 <= score <= 9
