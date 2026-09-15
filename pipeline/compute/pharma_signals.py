"""Compute health-sector catalyst signals: pharma_trials -> pharma_signals.

Turns raw clinical-trial records into forward-looking catalyst signals for the
equity terminal. Each near-term trial event (an upcoming primary-completion
"readout", a recent readout, or posted results) becomes a `pharma_signals`
row with a direction, a phase-weighted confidence, and days-to-catalyst.

Usage:
    python -m pipeline.compute.pharma_signals
"""
from __future__ import annotations

import logging
import os
from datetime import date, datetime, timezone

from dotenv import load_dotenv
from supabase import Client

from pipeline.utils.supabase import fetch_all

load_dotenv()
load_dotenv(".env.local")

logger = logging.getLogger(__name__)

# Phase -> base confidence (0-100). More advanced phase = higher conviction.
PHASE_CONFIDENCE = {
    "PHASE4": 55,
    "PHASE3": 80,
    "PHASE2_PHASE3": 70,
    "PHASE2": 60,
    "PHASE1_PHASE2": 50,
    "PHASE1": 40,
    "EARLY_PHASE1": 30,
}

UPCOMING_WINDOW_DAYS = 365   # look-ahead horizon for a readout catalyst
RECENT_WINDOW_DAYS = 90      # look-back horizon for a just-passed readout
ACTIVE_STATUSES = {"RECRUITING", "ACTIVE_NOT_RECRUITING", "ENROLLING_BY_INVITATION", "NOT_YET_RECRUITING"}


def _get_supabase_client() -> Client:
    from pipeline.utils.client import get_supabase
    return get_supabase()



def _classify(trial: dict, today: date) -> dict | None:
    """Return signal fields for a trial, or None if it is not a near-term catalyst."""
    comp = trial.get("completion_date")
    days_to = None
    if comp:
        try:
            days_to = (date.fromisoformat(comp) - today).days
        except ValueError:
            days_to = None

    status = (trial.get("overall_status") or "").upper()
    phase = trial.get("phase")
    base_conf = PHASE_CONFIDENCE.get(phase or "", 20)

    if trial.get("results_posted"):
        event_type, direction, conf = "RESULTS_POSTED", "WATCH", base_conf
    elif status == "COMPLETED" and days_to is not None and -RECENT_WINDOW_DAYS <= days_to <= 0:
        event_type = "READOUT"
        direction = "LONG" if phase in ("PHASE3", "PHASE2_PHASE3") else "WATCH"
        conf = base_conf + 10
    elif status in ACTIVE_STATUSES and days_to is not None and 0 < days_to <= UPCOMING_WINDOW_DAYS:
        event_type = "UPCOMING_READOUT"
        direction = "LONG" if phase == "PHASE3" else "WATCH"
        # nearer catalysts get a small confidence bump
        conf = base_conf + (10 if days_to <= 90 else 0)
    else:
        return None

    return {
        "event_type": event_type,
        "direction": direction,
        "phase": phase,
        "confidence": max(0, min(100, int(conf))),
        "days_to_catalyst": days_to,
    }


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== Pharma Signals Compute Start ===")

    sb = _get_supabase_client()

    trials = fetch_all(sb, "pharma_trials", "nct_id, ticker, phase, overall_status, completion_date, results_posted")
    if not trials:
        logger.warning("No pharma_trials found — run `python -m pipeline.ingest.pharma_trials` first")
        return

    price_rows = fetch_all(sb, "fundamentals_snapshot", "symbol, price")
    price_map = {r["symbol"]: r.get("price") for r in price_rows}

    today = date.today()
    now = datetime.now(timezone.utc).isoformat()

    signals: list[dict] = []
    for t in trials:
        if not t.get("ticker") or not t.get("nct_id"):
            continue
        sig = _classify(t, today)
        if not sig:
            continue
        signals.append({
            "ticker": t["ticker"],
            "nct_id": t["nct_id"],
            "price_at_signal": price_map.get(t["ticker"]),
            "detected_at": now,
            **sig,
        })

    if not signals:
        logger.info("No near-term catalysts detected from %d trials", len(trials))
        return

    batch = 200
    for i in range(0, len(signals), batch):
        try:
            sb.table("pharma_signals").upsert(
                signals[i:i + batch], on_conflict="nct_id,event_type"
            ).execute()
        except Exception:
            logger.exception("Failed to upsert pharma_signals batch %d", i)

    by_type: dict[str, int] = {}
    for s in signals:
        by_type[s["event_type"]] = by_type.get(s["event_type"], 0) + 1
    longs = sum(1 for s in signals if s["direction"] == "LONG")
    logger.info(
        "=== Pharma Signals Complete: %d signals (%s) | %d LONG from %d trials ===",
        len(signals), ", ".join(f"{k}={v}" for k, v in by_type.items()), longs, len(trials),
    )


if __name__ == "__main__":
    main()
