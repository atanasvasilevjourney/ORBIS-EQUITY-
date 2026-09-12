"""Unit tests for pipeline.compute.pharma_signals signal logic."""
from datetime import date, timedelta

from pipeline.compute.pharma_signals import _compute_signal


def _base_trial(**overrides) -> dict:
    trial = {
        "nct_id": "NCT00000001",
        "ticker": "PFE",
        "phase": "PHASE3",
        "overall_status": "COMPLETED",
        "results_posted": True,
        "primary_endpoint_met": True,
        "completion_date": date.today().isoformat(),
    }
    trial.update(overrides)
    return trial


class TestComputeSignal:
    def test_missing_ticker_returns_none(self):
        assert _compute_signal(_base_trial(ticker=None)) is None

    def test_missing_phase_returns_none(self):
        assert _compute_signal(_base_trial(phase=None)) is None

    def test_completed_with_endpoint_met_long(self):
        sig = _compute_signal(_base_trial())
        assert sig is not None
        assert sig["direction"] == "LONG"
        assert sig["event_type"] == "RESULTS_POSTED"
        assert sig["confidence"] >= 60

    def test_completed_endpoint_missed_short(self):
        sig = _compute_signal(_base_trial(primary_endpoint_met=False))
        assert sig is not None
        assert sig["direction"] == "SHORT"
        assert sig["event_type"] == "ENDPOINT_MISSED"

    def test_terminated_short(self):
        sig = _compute_signal(_base_trial(
            overall_status="TERMINATED",
            results_posted=False,
            primary_endpoint_met=None,
        ))
        assert sig is not None
        assert sig["direction"] == "SHORT"
        assert sig["event_type"] == "TRIAL_FAILURE"

    def test_recruiting_watch(self):
        sig = _compute_signal(_base_trial(
            overall_status="RECRUITING",
            results_posted=False,
            primary_endpoint_met=None,
        ))
        assert sig is not None
        assert sig["direction"] == "WATCH"
        assert sig["event_type"] == "ACTIVE_TRIAL"

    def test_pending_readout_watch(self):
        sig = _compute_signal(_base_trial(
            results_posted=False,
            primary_endpoint_met=None,
        ))
        assert sig is not None
        assert sig["direction"] == "WATCH"
        assert sig["event_type"] == "PENDING_READOUT"

    def test_phase2_lower_confidence(self):
        sig = _compute_signal(_base_trial(phase="PHASE2"))
        assert sig is not None
        assert sig["confidence"] < 80  # phase3 base 60 + results 20 = 80; phase2 base 40 + 20 = 60

    def test_confidence_capped_at_100(self):
        near_date = (date.today() + timedelta(days=30)).isoformat()
        sig = _compute_signal(_base_trial(
            overall_status="TERMINATED",
            results_posted=True,
            primary_endpoint_met=None,
            completion_date=near_date,
        ))
        assert sig is not None
        assert sig["confidence"] <= 100

    def test_unknown_status_returns_none(self):
        assert _compute_signal(_base_trial(overall_status="UNKNOWN")) is None
