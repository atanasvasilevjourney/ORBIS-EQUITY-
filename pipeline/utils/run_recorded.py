"""Run a pipeline module body with ``PipelineRunRecorder`` (Phase 1)."""
from __future__ import annotations

import logging
import os
from collections.abc import Callable
from datetime import date

from supabase import Client, create_client

from pipeline.utils.pipeline_runs import PipelineRunRecorder

logger = logging.getLogger(__name__)


def supabase_client() -> Client:
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(url, key)


def run_recorded(
    source: str,
    fn: Callable[[Client, PipelineRunRecorder], None],
    *,
    asof_date: date | None = None,
) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    sb = supabase_client()
    with PipelineRunRecorder(sb, source, asof_date=asof_date or date.today()) as run:
        fn(sb, run)
