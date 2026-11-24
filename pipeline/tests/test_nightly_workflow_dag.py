"""Validate nightly-pipeline.yml job DAG against run #97 race-condition fixes."""
from __future__ import annotations

from pathlib import Path

import yaml

WORKFLOW_PATH = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "nightly-pipeline.yml"


def _load_workflow() -> dict:
    with WORKFLOW_PATH.open(encoding="utf-8") as f:
        return yaml.safe_load(f)


def _job(workflow: dict, name: str) -> dict:
    jobs = workflow["jobs"]
    assert name in jobs, f"missing job {name}"
    return jobs[name]


def _step_by_id(job: dict, step_id: str) -> dict | None:
    for step in job.get("steps", []):
        if step.get("id") == step_id:
            return step
    return None


def test_compute_signals_waits_for_financial_reports():
    wf = _load_workflow()
    job = _job(wf, "compute-signals")
    needs = job.get("needs", [])
    if isinstance(needs, str):
        needs = [needs]
    assert "ingest-prices" in needs
    assert "ingest-financial-reports" in needs
    cond = job.get("if", "")
    assert "ingest-financial-reports.result == 'success'" in cond
    assert "ingest-financial-reports.result == 'skipped'" in cond


def test_ingest_earnings_news_runs_after_compute_failure():
    wf = _load_workflow()
    job = _job(wf, "ingest-earnings-news")
    needs = job.get("needs", [])
    if isinstance(needs, str):
        needs = [needs]
    assert "ingest-prices" in needs
    assert "compute-signals" in needs
    cond = job.get("if", "")
    assert "needs.compute-signals.result == 'failure'" in cond


def test_f_score_uses_continue_on_error_with_final_fail_loud():
    wf = _load_workflow()
    job = _job(wf, "compute-signals")
    f_step = _step_by_id(job, "f_score")
    assert f_step is not None
    assert f_step.get("continue-on-error") is True

    report = next(
        s for s in job["steps"] if s.get("name") == "Report compute job status"
    )
    script = report["run"]
    assert "steps.f_score.outcome" in script
    assert "exit 1" in script


def test_weekly_chain_order_in_workflow():
    """Monday chain: prices → fundamentals → financial-reports before compute."""
    wf = _load_workflow()
    assert _job(wf, "ingest-fundamentals")["needs"] == "ingest-prices"
    assert _job(wf, "ingest-financial-reports")["needs"] == "ingest-fundamentals"
    compute_needs = _job(wf, "compute-signals")["needs"]
    assert "ingest-financial-reports" in (
        compute_needs if isinstance(compute_needs, list) else [compute_needs]
    )