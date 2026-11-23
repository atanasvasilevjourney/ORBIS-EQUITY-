from postgrest.exceptions import APIError

from pipeline.utils.supabase_errors import is_missing_column, is_missing_relation


def test_is_missing_relation_pgrst205():
    err = APIError(
        {
            "message": "Could not find the table 'public.research_weekly_runs' in the schema cache",
            "code": "PGRST205",
        }
    )
    assert is_missing_relation(err) is True


def test_is_missing_relation_not_column_error():
    err = {"code": "42703", "message": "column research_weekly_setups.horizon does not exist"}
    assert is_missing_relation(err) is False
    assert is_missing_column(err) is True