"""Pipeline run recorder writes (mocked Supabase)."""
from unittest.mock import MagicMock

from pipeline.utils.pipeline_runs import PipelineRunRecorder


def test_pipeline_run_recorder_ok():
    sb = MagicMock()
    table = MagicMock()
    sb.table.return_value = table
    table.upsert.return_value.execute.return_value = MagicMock()

    with PipelineRunRecorder(sb, "test_module") as run:
        run.set_row_counts(rows=10)
        run.set_headline("ok")

    assert table.upsert.call_count >= 2
    final = table.upsert.call_args_list[-1][0][0]
    assert final["source"] == "test_module"
    assert final["status"] == "ok"
    assert final["row_counts"]["rows"] == 10
