"""Write atomic pipeline run rows to Supabase ``pipeline_runs``."""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timezone
from typing import Any

from supabase import Client

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class PipelineRunRecorder:
    """Context manager: insert running row, finalize on exit."""

    def __init__(
        self,
        sb: Client,
        source: str,
        *,
        asof_date: date | None = None,
        config: dict[str, Any] | None = None,
    ) -> None:
        self.sb = sb
        self.source = source
        self.asof_date = asof_date or date.today()
        self.config = config or {}
        self.run_id = f"{source}_{self.asof_date.isoformat()}_{uuid.uuid4().hex[:10]}"
        self.started = _now()
        self._status = "ok"
        self._row_counts: dict[str, Any] = {}
        self._headline = ""
        self._error: str | None = None

    def __enter__(self) -> PipelineRunRecorder:
        self._write(
            status="running",
            finished=None,
            row_counts=None,
            headline=None,
            error=None,
        )
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if exc is not None:
            self._status = "error"
            self._error = str(exc)[:2000]
        self._persist_final()

    def set_row_counts(self, **counts: int | float | str) -> None:
        self._row_counts.update(counts)

    def set_headline(self, headline: str) -> None:
        self._headline = headline

    def mark_partial(self, error: str | None = None) -> None:
        self._status = "partial"
        if error:
            self._error = error[:2000]

    def mark_error(self, error: str) -> None:
        self._status = "error"
        self._error = error[:2000]

    def _persist_final(self) -> None:
        self._write(
            status=self._status,
            finished=_now(),
            row_counts=self._row_counts or None,
            headline=self._headline or None,
            error=self._error,
        )

    def _write(
        self,
        *,
        status: str,
        finished: datetime | None,
        row_counts: dict[str, Any] | None,
        headline: str | None,
        error: str | None,
    ) -> None:
        payload = {
            "run_id": self.run_id,
            "source": self.source,
            "status": status,
            "row_counts": row_counts,
            "asof_date": self.asof_date.isoformat(),
            "started_at": self.started.isoformat(),
            "finished_at": finished.isoformat() if finished else None,
            "headline": headline,
            "error": error,
            "config": self.config or None,
        }
        try:
            self.sb.table("pipeline_runs").upsert(payload, on_conflict="run_id").execute()
        except Exception:
            logger.warning(
                "pipeline_runs write skipped (apply migration 024)",
                exc_info=True,
            )
