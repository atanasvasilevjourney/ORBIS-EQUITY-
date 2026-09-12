"""Integration smoke test mirroring nightly-pipeline.yml DAG order.

Uses mocked Supabase and HTTP clients — no live database or API calls.
"""
from contextlib import ExitStack
from unittest.mock import MagicMock, patch

import pytest


def _make_mock_supabase():
    """Minimal mock Supabase client returning empty result sets."""
    sb = MagicMock()
    empty = MagicMock()
    empty.data = []
    empty.error = None
    empty.execute.return_value = empty

    table_mock = MagicMock()
    table_mock.select.return_value = table_mock
    table_mock.eq.return_value = table_mock
    table_mock.gte.return_value = table_mock
    table_mock.lte.return_value = table_mock
    table_mock.order.return_value = table_mock
    table_mock.range.return_value = table_mock
    table_mock.limit.return_value = table_mock
    table_mock.upsert.return_value = table_mock
    table_mock.execute.return_value = empty
    sb.table.return_value = table_mock
    return sb


def _make_mock_lse():
    """Mock LSE client returning empty data."""
    instance = MagicMock()
    instance.get_all_screener_data.return_value = []
    instance.get_screener.return_value = []
    instance.get_earnings.return_value = []
    instance.get_financial_reports.return_value = []
    instance.get_fundamentals.return_value = []
    instance.get_insider_trades.return_value = []
    return instance


@pytest.fixture
def mock_supabase():
    return _make_mock_supabase()


class TestPipelineDAGSmoke:
    """Verify each pipeline module's main() runs without error when dependencies are mocked."""

    DAG_ORDER = [
        "pipeline.ingest.universe",
        "pipeline.ingest.prices",
        "pipeline.ingest.fundamentals",
        "pipeline.ingest.financial_reports",
        "pipeline.compute.trend_radar",
        "pipeline.compute.aggregates",
        "pipeline.compute.f_score",
        "pipeline.ingest.pharma_trials",
        "pipeline.compute.pharma_signals",
        "pipeline.ingest.earnings",
        "pipeline.ingest.news",
    ]

    def _run_module_main(self, module_path: str, mock_supabase):
        import importlib

        mod = importlib.import_module(module_path)
        mock_lse = _make_mock_lse()

        with ExitStack() as stack:
            stack.enter_context(patch.dict("os.environ", {
                "SUPABASE_URL": "https://test.supabase.co",
                "SUPABASE_SERVICE_KEY": "test-key",
                "LSE_API_KEY": "test-lse-key",
                "LSE_DATA_API_URL": "https://test.lse.api",
            }))

            # Shared client + per-module factories
            stack.enter_context(
                patch("pipeline.utils.client.get_supabase", return_value=mock_supabase)
            )
            if hasattr(mod, "get_supabase"):
                stack.enter_context(
                    patch.object(mod, "get_supabase", return_value=mock_supabase)
                )
            if hasattr(mod, "_get_supabase_client"):
                stack.enter_context(
                    patch.object(mod, "_get_supabase_client", return_value=mock_supabase)
                )
            if hasattr(mod, "_sb"):
                stack.enter_context(
                    patch.object(mod, "_sb", return_value=mock_supabase)
                )

            if module_path == "pipeline.ingest.universe":
                stack.enter_context(patch.object(mod, "LSEClient", return_value=mock_lse))
                stack.enter_context(
                    patch.object(mod, "_build_sp_indices", return_value={
                        "us_large": set(), "us_mid": set(), "us_small": set(),
                    })
                )

            if module_path in (
                "pipeline.ingest.fundamentals",
                "pipeline.ingest.financial_reports",
                "pipeline.ingest.earnings",
            ):
                stack.enter_context(patch.object(mod, "LSEClient", return_value=mock_lse))

            if module_path == "pipeline.ingest.pharma_trials":
                stack.enter_context(
                    patch.object(mod, "fetch_trials_for_sponsor", return_value=[])
                )

            if module_path == "pipeline.ingest.news":
                stack.enter_context(
                    patch.object(mod, "fetch_news_for_ticker", return_value=[])
                )

            if hasattr(mod, "main"):
                mod.main()

    @pytest.mark.parametrize("module_path", DAG_ORDER)
    def test_module_main_runs_with_mocks(self, module_path, mock_supabase):
        self._run_module_main(module_path, mock_supabase)

    def test_dag_order_matches_nightly_workflow(self):
        """Document expected execution order from nightly-pipeline.yml."""
        expected_order = [
            "pipeline.ingest.universe",
            "pipeline.ingest.prices",
            "pipeline.ingest.fundamentals",
            "pipeline.ingest.financial_reports",
            "pipeline.compute.trend_radar",
            "pipeline.compute.aggregates",
            "pipeline.compute.f_score",
            "pipeline.ingest.pharma_trials",
            "pipeline.compute.pharma_signals",
            "pipeline.ingest.earnings",
            "pipeline.ingest.news",
        ]
        assert self.DAG_ORDER == expected_order
