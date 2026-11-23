from unittest.mock import MagicMock, patch

import pytest
from postgrest.exceptions import APIError

from pipeline.notify.research_weekly_digest import main
from pipeline.research_framework.schema_preflight import (
    ResearchWeeklySchemaError,
    check_research_weekly_schema,
)
from pipeline.utils.supabase_errors import is_missing_relation


def test_check_research_weekly_schema_raises_on_missing_runs():
    sb = MagicMock()
    sb.table.return_value.select.return_value.limit.return_value.execute.side_effect = APIError(
        {
            "code": "PGRST205",
            "message": "Could not find the table 'public.research_weekly_runs' in the schema cache",
        }
    )
    with pytest.raises(ResearchWeeklySchemaError) as exc:
        check_research_weekly_schema(sb)
    assert "027_research_weekly.sql" in str(exc.value)


def test_digest_main_exits_on_schema_error():
    with patch("pipeline.notify.research_weekly_digest.run_digest") as run_digest:
        run_digest.side_effect = ResearchWeeklySchemaError("apply 027")
        assert main(["--dry-run"]) == 1


def test_is_missing_relation_matches_github_actions_failure():
    err = APIError(
        {
            "code": "PGRST205",
            "message": "Could not find the table 'public.research_weekly_runs' in the schema cache",
        }
    )
    assert is_missing_relation(err)