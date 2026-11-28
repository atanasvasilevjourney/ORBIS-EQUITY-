"""Screener host fallback and statement fill when the catalog host rejects the key."""
from unittest.mock import MagicMock

import requests

from pipeline.clients.lse_api import LSEClient
from pipeline.compute.fundamentals_derived import (
    _growth_ratio,
    patch_missing_snapshot,
    statement_fields_from_reports,
)
from pipeline.config.settings import LSEConfig
from pipeline.ingest.fundamentals import (
    FundamentalsIngestResult,
    _ingest_fundamentals,
    _record_fundamentals_outcome,
)


def _client() -> LSEClient:
    client = LSEClient(
        LSEConfig(
            api_url="https://api.example",
            data_api_url="https://data.example",
            api_key="test-key",
            request_delay=0,
        )
    )
    return client


def _response(status: int, payload: list | None = None) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status
    if status >= 400:
        err = requests.HTTPError(f"{status} Client Error", response=resp)
        resp.raise_for_status.side_effect = err
    else:
        resp.raise_for_status.return_value = None
        resp.json.return_value = payload if payload is not None else []
    return resp


def test_screener_retries_data_api_after_401_and_stays_there():
    client = _client()
    client.session.get = MagicMock(
        side_effect=[
            _response(401),
            _response(200, [{"symbol": "AAPL"}]),
            _response(200, [{"symbol": "MSFT"}]),
        ]
    )
    first = client.get_screener(limit=1)
    second = client.get_screener(limit=1)
    urls = [call.args[0] for call in client.session.get.call_args_list]
    assert first == [{"symbol": "AAPL"}]
    assert second == [{"symbol": "MSFT"}]
    assert urls == [
        "https://api.example/stock_screener",
        "https://data.example/stock_screener",
        "https://data.example/stock_screener",
    ]


def test_screener_401_on_both_hosts_raises():
    client = _client()
    client.session.get = MagicMock(side_effect=[_response(401), _response(401)])
    try:
        client.get_screener(limit=1)
    except requests.HTTPError as err:
        assert err.response.status_code == 401
    else:
        raise AssertionError("expected HTTPError")


def test_statement_fields_fill_only_missing_snapshot_values():
    fields = statement_fields_from_reports(
        income_cur={
            "filing_date": "2025-02-01",
            "date": "2024-12-31",
            "data": {
                "revenue": 100.0,
                "netIncome": 10.0,
                "grossProfit": 40.0,
                "operatingIncome": 20.0,
                "epsDiluted": 2.0,
                "weightedAverageShsOutDil": 5.0,
            },
        },
        income_pri={"data": {"revenue": 80.0, "netIncome": 8.0}},
        income_old=None,
        balance_cur={"data": {"totalAssets": 50.0, "totalStockholdersEquity": 30.0, "totalDebt": 10.0}},
        cashflow_cur={"data": {"operatingCashFlow": 12.0, "capitalExpenditure": -2.0, "freeCashFlow": 10.0}},
        growth_cur=None,
        metrics_cur=None,
        price=20.0,
        sector="Technology",
        industry="Software",
    )
    assert fields["revenue"] == 100.0
    assert fields["pe_ratio"] == 10.0
    assert fields["net_margin"] == 0.1
    patch = patch_missing_snapshot(
        {"symbol": "AAPL", "pe_ratio": 22.0, "revenue": None, "source": "lse"},
        fields,
        ratios_date="2025-02-01",
    )
    assert "pe_ratio" not in patch
    assert patch["revenue"] == 100.0
    assert "source" not in patch
    assert patch["ratios_date"] == "2025-02-01"


def test_three_year_growth_skips_a_negative_base():
    assert _growth_ratio(-10, 5, 3) is None
    assert _growth_ratio(-10, 5, 1) == -3.0
    grown = _growth_ratio(100, 80, 3)
    assert isinstance(grown, float)
    fields = statement_fields_from_reports(
        income_cur={"data": {"revenue": 10.0, "netIncome": 1.0}},
        income_pri={"data": {"revenue": 8.0, "netIncome": 1.0}},
        income_old={"data": {"revenue": -5.0, "netIncome": -1.0}},
        balance_cur=None,
        cashflow_cur=None,
        growth_cur=None,
        metrics_cur=None,
        price=20.0,
        sector="Technology",
        industry="Software",
    )
    assert "revenue_growth_3y" not in fields
    assert isinstance(fields["revenue"], float)


def test_ingest_keeps_snapshot_when_screener_401(monkeypatch):
    lse = MagicMock()
    resp = MagicMock(status_code=401)
    lse.get_all_screener_data.side_effect = requests.HTTPError("401 Client Error", response=resp)
    monkeypatch.setattr(
        "pipeline.ingest.fundamentals.fill_missing_from_statements",
        lambda sb: 4,
    )
    result = _ingest_fundamentals(lse, MagicMock())
    assert result.upserted == 0
    assert result.rows == []
    assert result.screener_error
    assert result.statement_fills == 4
    assert "401" in result.screener_error


class _Run:
    def __init__(self):
        self.status = "ok"
        self.error = None
        self.counts = {}

    def mark_partial(self, error=None):
        self.status = "partial"
        self.error = error

    def mark_error(self, error):
        self.status = "error"
        self.error = error

    def set_row_counts(self, **counts):
        self.counts.update(counts)


def test_main_invokes_the_recorded_ingest(monkeypatch):
    seen = {}

    def fake_run_recorded(source, fn, **kwargs):
        seen["source"] = source
        seen["fn"] = fn

    monkeypatch.setattr("pipeline.utils.run_recorded.run_recorded", fake_run_recorded)
    from pipeline.ingest.fundamentals import main

    main()
    assert seen["source"] == "ingest.fundamentals"
    assert callable(seen["fn"])


def test_screener_failure_is_partial_so_the_job_can_continue():
    run = _Run()
    _record_fundamentals_outcome(
        run,
        FundamentalsIngestResult(0, [], "401 Client Error", 4),
        MagicMock(),
    )
    assert run.status == "partial"
    assert "kept existing" in run.error
    assert run.counts["statement_fills"] == 4
