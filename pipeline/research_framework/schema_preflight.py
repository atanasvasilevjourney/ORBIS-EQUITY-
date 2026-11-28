"""Verify research_weekly tables exist before pack / digest jobs."""
from __future__ import annotations

import logging
import os
import sys

from dotenv import load_dotenv

from pipeline.utils.supabase_errors import is_missing_column, is_missing_relation

logger = logging.getLogger(__name__)

RESEARCH_WEEKLY_MIGRATION_HINT = (
    "research_weekly tables are missing in production Supabase. Apply in the SQL editor "
    "(in order):\n"
    "  1. supabase/migrations/027_research_weekly.sql\n"
    "  2. supabase/migrations/035_research_weekly_horizons.sql\n"
    "Or paste both files back-to-back. After apply, run:\n"
    "  python -m pipeline.research_framework.jobs.weekly\n"
    "GitHub Actions does not apply Supabase migrations on merge."
)


class ResearchWeeklySchemaError(RuntimeError):
    """Hosted schema lacks research_weekly_runs / research_weekly_setups."""

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message or RESEARCH_WEEKLY_MIGRATION_HINT)


def check_research_weekly_schema(sb) -> None:
    """Raise ResearchWeeklySchemaError when pack tables are not in PostgREST."""
    try:
        sb.table("research_weekly_runs").select("run_id").limit(1).execute()
    except Exception as exc:
        if is_missing_relation(exc):
            raise ResearchWeeklySchemaError(RESEARCH_WEEKLY_MIGRATION_HINT) from exc
        raise
    try:
        sb.table("research_weekly_setups").select("id,horizon").limit(1).execute()
    except Exception as exc:
        if is_missing_relation(exc):
            raise ResearchWeeklySchemaError(RESEARCH_WEEKLY_MIGRATION_HINT) from exc
        if is_missing_column(exc):
            raise ResearchWeeklySchemaError(
                "research_weekly_setups is missing horizon columns — apply "
                "supabase/migrations/035_research_weekly_horizons.sql in Supabase."
            ) from exc
        raise


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO)
    load_dotenv()
    load_dotenv(".env.local")
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
    if not url or not key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
        return 1
    from supabase import create_client

    sb = create_client(url, key)
    try:
        check_research_weekly_schema(sb)
    except ResearchWeeklySchemaError as exc:
        logger.error("%s", exc)
        return 1
    logger.info("research_weekly schema OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())