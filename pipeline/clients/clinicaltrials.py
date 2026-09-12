"""ClinicalTrials.gov Data API v2 client — free, no API key required.

The NIH/NLM registry exposes a public, unauthenticated REST API returning
JSON. This is the health-sector catalyst source for KovaView (clinical-trial
readouts / status changes that move biotech & pharma equities).

API docs : https://clinicaltrials.gov/data-api/api
Base URL : https://clinicaltrials.gov/api/v2
Notes    : cursor pagination via `pageToken`; nested `protocolSection` schema.
"""
from __future__ import annotations

import logging
import time
from typing import Any

import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://clinicaltrials.gov/api/v2/studies"
REQUEST_DELAY = 0.5  # polite delay between requests

# Phases reported by the registry, ordered so we can pick the most advanced.
_PHASE_ORDER = {
    "EARLY_PHASE1": 0,
    "PHASE1": 1,
    "PHASE1_PHASE2": 2,
    "PHASE2": 3,
    "PHASE2_PHASE3": 4,
    "PHASE3": 5,
    "PHASE4": 6,
}


def _pick_phase(phases: list[str]) -> str | None:
    if not phases:
        return None
    return max(phases, key=lambda p: _PHASE_ORDER.get(p, -1))


def _struct_date(node: dict[str, Any] | None) -> str | None:
    """ClinicalTrials date structs look like {"date": "2026-08", "type": ...}.

    Normalizes YYYY / YYYY-MM to a full ISO date so Postgres DATE accepts it.
    """
    if not node:
        return None
    raw = node.get("date")
    if not raw:
        return None
    parts = raw.split("-")
    if len(parts) == 1:
        return f"{parts[0]}-01-01"
    if len(parts) == 2:
        return f"{parts[0]}-{parts[1]}-01"
    return raw


def _parse_study(study: dict[str, Any]) -> dict[str, Any] | None:
    ps = study.get("protocolSection") or {}
    ident = ps.get("identificationModule") or {}
    status = ps.get("statusModule") or {}
    sponsor = (ps.get("sponsorCollaboratorsModule") or {}).get("leadSponsor") or {}
    conditions = (ps.get("conditionsModule") or {}).get("conditions") or []
    design = ps.get("designModule") or {}
    interventions = (ps.get("armsInterventionsModule") or {}).get("interventions") or []

    nct_id = ident.get("nctId")
    if not nct_id:
        return None

    drug = None
    for iv in interventions:
        if (iv.get("type") or "").upper() == "DRUG":
            drug = iv.get("name")
            break
    if not drug and interventions:
        drug = interventions[0].get("name")
    if not drug:
        drug = ident.get("briefTitle")

    has_results = bool(study.get("hasResults"))

    return {
        "nct_id": nct_id,
        "drug_name": (drug or "")[:200] or None,
        "condition": (conditions[0] if conditions else None),
        "phase": _pick_phase(design.get("phases") or []),
        "overall_status": status.get("overallStatus"),
        "lead_sponsor": sponsor.get("name"),
        "start_date": _struct_date(status.get("startDateStruct")),
        "completion_date": _struct_date(
            status.get("primaryCompletionDateStruct") or status.get("completionDateStruct")
        ),
        "results_posted": has_results,
        "last_status_change": _struct_date(status.get("lastUpdatePostDateStruct")),
    }


def fetch_trials_for_sponsor(
    sponsor: str,
    max_records: int = 25,
    interventional_only: bool = True,
) -> list[dict[str, Any]]:
    """Fetch recent trials led by `sponsor` from ClinicalTrials.gov.

    Returns a list of normalized trial dicts ready to upsert into
    `pharma_trials` (minus the `ticker` tag, which the ingest step adds).
    """
    params: dict[str, str] = {
        "query.lead": sponsor,
        "pageSize": str(min(max_records, 100)),
        "sort": "LastUpdatePostDate:desc",
        "format": "json",
    }
    if interventional_only:
        # v2 has no `filter.studyType`; use the advanced AREA[] filter instead.
        params["filter.advanced"] = "AREA[StudyType]INTERVENTIONAL"

    try:
        resp = requests.get(BASE_URL, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        logger.exception("ClinicalTrials.gov fetch failed for sponsor %s", sponsor)
        return []

    studies = data.get("studies", []) or []
    results: list[dict[str, Any]] = []
    for study in studies[:max_records]:
        parsed = _parse_study(study)
        if parsed:
            results.append(parsed)

    time.sleep(REQUEST_DELAY)
    return results
