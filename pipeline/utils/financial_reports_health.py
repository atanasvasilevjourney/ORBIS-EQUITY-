"""Freshness and auth helpers for financial_reports ingest and F-Score compute."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from supabase import Client

DEFAULT_STALE_GRACE_DAYS = 120


def is_lse_auth_error(exc: BaseException | str | None) -> bool:
    if exc is None:
        return False
    text = str(exc).lower()
    return "401" in text or "403" in text or "unauthorized" in text or "forbidden" in text


def count_financial_report_rows(sb: Client) -> int:
    """Approximate row count without loading the full table."""
    resp = (
        sb.table("financial_reports")
        .select("symbol", count="exact")
        .limit(1)
        .execute()
    )
    return int(getattr(resp, "count", None) or 0)


def financial_reports_latest_known_on(sb: Client) -> date | None:
    """Newest ``filing_date`` or fiscal ``date`` present in ``financial_reports``."""
    for column in ("filing_date", "date"):
        resp = (
            sb.table("financial_reports")
            .select(column)
            .not_.is_(column, "null")
            .order(column, desc=True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if rows and rows[0].get(column):
            return date.fromisoformat(str(rows[0][column])[:10])
    return None


def count_scored_f_scores(sb: Client) -> int:
    resp = (
        sb.table("fundamentals_snapshot")
        .select("symbol", count="exact")
        .not_.is_("f_score", "null")
        .limit(1)
        .execute()
    )
    return int(getattr(resp, "count", None) or 0)


def last_successful_pipeline_run(
    sb: Client,
    source: str,
    *,
    statuses: tuple[str, ...] = ("ok", "partial"),
) -> dict[str, Any] | None:
    query = (
        sb.table("pipeline_runs")
        .select("finished_at,asof_date,status,row_counts,headline")
        .eq("source", source)
        .in_("status", list(statuses))
        .not_.is_("finished_at", "null")
        .order("finished_at", desc=True)
        .limit(1)
    )
    resp = query.execute()
    rows = resp.data or []
    return rows[0] if rows else None


def _parse_finished_at(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def f_score_degradation_allowed(
    sb: Client,
    *,
    as_of: date | None = None,
    max_age_days: int = DEFAULT_STALE_GRACE_DAYS,
    min_scored_symbols: int = 50,
) -> tuple[bool, str]:
    """Return whether compute may continue with existing F-Scores instead of failing."""
    as_of = as_of or date.today()
    cutoff = as_of - timedelta(days=max_age_days)
    reasons: list[str] = []

    report_known = financial_reports_latest_known_on(sb)
    if report_known and report_known >= cutoff:
        reasons.append(f"financial_reports latest known_on={report_known.isoformat()}")

    scored = count_scored_f_scores(sb)
    if scored >= min_scored_symbols:
        reasons.append(f"fundamentals_snapshot has {scored} existing f_score values")

    last_run = last_successful_pipeline_run(sb, "compute.f_score")
    if last_run:
        finished = _parse_finished_at(last_run.get("finished_at"))
        row_counts = last_run.get("row_counts") or {}
        prior_scored = int(row_counts.get("scored") or 0)
        if finished and finished.date() >= cutoff and prior_scored >= min_scored_symbols:
            reasons.append(
                f"last successful compute.f_score on {finished.date().isoformat()} "
                f"({prior_scored} scored)"
            )

    if not reasons:
        return (
            False,
            f"no F-Score snapshot or financial_reports data within {max_age_days} days",
        )
    return True, "; ".join(reasons)