"""ClinicalTrials.gov v2 API client.

Fetches Phase 2/3 interventional drug trials for publicly traded
pharmaceutical and biotech companies.

API docs: https://clinicaltrials.gov/data-api/about-api/study-data-structure
"""
import logging
import time
from typing import Any

import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://clinicaltrials.gov/api/v2/studies"
PAGE_SIZE = 100


def _extract_trial(study: dict) -> dict | None:
    """Extract relevant fields from a ClinicalTrials.gov v2 study object."""
    proto = study.get("protocolSection", {})
    ident = proto.get("identificationModule", {})
    status = proto.get("statusModule", {})
    sponsor = proto.get("sponsorCollaboratorsModule", {})
    design = proto.get("designModule", {})
    conditions = proto.get("conditionsModule", {})
    arms = proto.get("armsInterventionsModule", {})

    nct_id = ident.get("nctId")
    if not nct_id:
        return None

    # Extract drug name from interventions
    drug_name = None
    interventions = arms.get("interventions", [])
    for interv in interventions:
        if interv.get("type") in ("DRUG", "BIOLOGICAL"):
            drug_name = interv.get("name")
            break
    if not drug_name:
        drug_name = ident.get("briefTitle", "")[:100]

    # Extract phase
    phases = design.get("phases", [])
    phase = phases[0] if phases else None

    # Extract dates
    start = status.get("startDateStruct", {}).get("date")
    completion = status.get("completionDateStruct", {}).get("date")
    primary_completion = status.get("primaryCompletionDateStruct", {}).get("date")

    # Check if results posted
    results_posted = status.get("resultsFirstPostDateStruct") is not None

    return {
        "nct_id": nct_id,
        "drug_name": drug_name,
        "condition": ", ".join(conditions.get("conditions", []))[:200],
        "phase": phase,
        "overall_status": status.get("overallStatus"),
        "lead_sponsor": sponsor.get("leadSponsor", {}).get("name"),
        "start_date": start,
        "completion_date": completion or primary_completion,
        "results_posted": results_posted,
        "brief_title": ident.get("briefTitle", "")[:200],
    }


def fetch_trials_for_sponsor(
    sponsor_name: str,
    phases: list[str] | None = None,
    statuses: list[str] | None = None,
    max_results: int = 200,
) -> list[dict]:
    """Fetch trials from ClinicalTrials.gov for a given sponsor.

    Args:
        sponsor_name: Company name (e.g., "Pfizer", "AstraZeneca")
        phases: Filter phases (e.g., ["PHASE2", "PHASE3"])
        statuses: Filter statuses (e.g., ["COMPLETED", "RECRUITING"])
        max_results: Maximum number of results to fetch

    Returns:
        List of extracted trial dicts
    """
    if phases is None:
        phases = ["PHASE2", "PHASE3"]
    if statuses is None:
        statuses = [
            "RECRUITING",
            "ACTIVE_NOT_RECRUITING",
            "COMPLETED",
            "TERMINATED",
            "SUSPENDED",
            "WITHDRAWN",
        ]

    # Build filter
    phase_filter = " OR ".join(f"AREA[Phase]{p}" for p in phases)
    status_filter = " OR ".join(f"AREA[OverallStatus]{s}" for s in statuses)
    advanced_filter = f"({phase_filter}) AND ({status_filter}) AND AREA[StudyType]INTERVENTIONAL"

    all_trials: list[dict] = []
    next_token: str | None = None

    while len(all_trials) < max_results:
        params: dict[str, str] = {
            "query.spons": sponsor_name,
            "filter.advanced": advanced_filter,
            "pageSize": str(min(PAGE_SIZE, max_results - len(all_trials))),
        }
        if next_token:
            params["pageToken"] = next_token

        try:
            resp = requests.get(BASE_URL, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
        except Exception:
            logger.exception("Failed to fetch trials for %s", sponsor_name)
            break

        studies = data.get("studies", [])
        if not studies:
            break

        for study in studies:
            trial = _extract_trial(study)
            if trial:
                all_trials.append(trial)

        next_token = data.get("nextPageToken")
        if not next_token:
            break

        time.sleep(0.3)  # Rate limiting

    return all_trials
