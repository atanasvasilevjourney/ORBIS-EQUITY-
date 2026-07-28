"""Pharma signal generator.

Scans pharma_trials for actionable events and generates trading signals:

Signal Rules:
  LONG  — Phase 3 completed + results posted (endpoint likely met)
  SHORT — Phase 3 terminated/withdrawn/suspended
  SHORT — Phase 2 terminated (early pipeline death)
  WATCH — Phase 3 actively recruiting (upcoming catalyst)
  WATCH — Phase 2/3 completed, results not yet posted (pending readout)

Confidence scoring (0-100):
  Base by phase: Phase 3 = 60, Phase 2 = 40
  +20 if results posted (confirmed outcome)
  +10 if completion date within 90 days
  +10 if status is terminal (TERMINATED/WITHDRAWN)
  Cap at 100

Usage:
    python -m pipeline.compute.pharma_signals
"""
import logging
import os
from datetime import date, datetime, timedelta, timezone

from dotenv import load_dotenv
from supabase import create_client, Client

from pipeline.config.settings import SupabaseConfig

load_dotenv()

logger = logging.getLogger(__name__)


def _get_supabase_client() -> Client:
    cfg = SupabaseConfig()
    if not cfg.url or not cfg.service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(cfg.url, cfg.service_key)


def _compute_signal(trial: dict) -> dict | None:
    """Determine trading signal from a trial record."""
    status = trial.get("overall_status", "")
    phase = trial.get("phase", "")
    results_posted = trial.get("results_posted", False)
    completion_str = trial.get("completion_date")
    ticker = trial.get("ticker")

    if not ticker or not phase:
        return None

    # Determine direction and event type
    direction = None
    event_type = None

    if status in ("TERMINATED", "WITHDRAWN", "SUSPENDED"):
        direction = "SHORT"
        event_type = "TRIAL_FAILURE"
    elif status == "COMPLETED" and results_posted:
        direction = "LONG"
        event_type = "RESULTS_POSTED"
    elif status == "COMPLETED" and not results_posted:
        direction = "WATCH"
        event_type = "PENDING_READOUT"
    elif status in ("RECRUITING", "ACTIVE_NOT_RECRUITING"):
        direction = "WATCH"
        event_type = "ACTIVE_TRIAL"
    else:
        return None

    # Confidence scoring
    confidence = 40 if "PHASE2" in phase else 60
    if results_posted:
        confidence += 20
    if status in ("TERMINATED", "WITHDRAWN"):
        confidence += 10
    if completion_str:
        try:
            comp_date = datetime.strptime(completion_str[:10], "%Y-%m-%d").date()
            days_away = (comp_date - date.today()).days
            if -90 <= days_away <= 90:
                confidence += 10
        except (ValueError, TypeError):
            pass

    confidence = min(confidence, 100)

    # Days to catalyst
    days_to_catalyst = None
    if completion_str:
        try:
            comp_date = datetime.strptime(completion_str[:10], "%Y-%m-%d").date()
            days_to_catalyst = (comp_date - date.today()).days
        except (ValueError, TypeError):
            pass

    return {
        "ticker": ticker,
        "nct_id": trial["nct_id"],
        "event_type": event_type,
        "direction": direction,
        "phase": phase,
        "confidence": confidence,
        "days_to_catalyst": days_to_catalyst,
        "detected_at": datetime.now(timezone.utc).isoformat(),
    }


def main() -> None:
    """Generate pharma signals from pharma_trials and upsert into pharma_signals."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== Pharma Signals Compute Start ===")

    sb = _get_supabase_client()

    # Fetch all trials
    resp = sb.table("pharma_trials").select("*").execute()
    trials = resp.data or []
    logger.info("Processing %d trials", len(trials))

    signals: list[dict] = []
    direction_counts: dict[str, int] = {"LONG": 0, "SHORT": 0, "WATCH": 0}

    for trial in trials:
        sig = _compute_signal(trial)
        if sig:
            signals.append(sig)
            direction_counts[sig["direction"]] = direction_counts.get(sig["direction"], 0) + 1

    logger.info(
        "Generated %d signals: LONG=%d SHORT=%d WATCH=%d",
        len(signals),
        direction_counts.get("LONG", 0),
        direction_counts.get("SHORT", 0),
        direction_counts.get("WATCH", 0),
    )

    if not signals:
        logger.info("No signals to upsert.")
        return

    # Clear old signals and insert fresh
    try:
        sb.table("pharma_signals").delete().neq("id", 0).execute()
    except Exception:
        logger.warning("Could not clear old signals, proceeding with upsert")

    # Batch insert
    batch_size = 200
    inserted = 0

    for i in range(0, len(signals), batch_size):
        batch = signals[i : i + batch_size]
        try:
            sb.table("pharma_signals").insert(batch).execute()
            inserted += len(batch)
            logger.info("Inserted %d/%d signals", inserted, len(signals))
        except Exception:
            logger.exception("Failed to insert signal batch %d-%d", i, i + len(batch))

    logger.info("=== Pharma Signals Compute Complete: %d signals ===", inserted)


if __name__ == "__main__":
    main()
