from __future__ import annotations

from pipeline.ingest import prices


class _Run:
    def __init__(self) -> None:
        self.partial: str | None = None
        self.error: str | None = None
        self.counts: dict = {}

    def mark_partial(self, error=None) -> None:
        self.partial = error

    def mark_error(self, error) -> None:
        self.error = error

    def set_row_counts(self, **counts) -> None:
        self.counts.update(counts)

    def set_headline(self, headline) -> None:
        pass


class _Table:
    def __init__(self, fail: bool) -> None:
        self.fail = fail

    def upsert(self, batch, on_conflict=None):
        return self

    def execute(self):
        if self.fail:
            raise RuntimeError("boom")


class _SB:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail

    def table(self, name):
        return _Table(self.fail)


def _bar(symbol: str) -> dict:
    return {
        "symbol": symbol,
        "date": "2026-10-16",
        "open": 1.0,
        "high": 1.0,
        "low": 1.0,
        "close": 1.0,
        "adj_close": 1.0,
        "volume": 1,
        "source": "stooq",
    }


def test_yfinance_names_missing_rows_fall_back_to_cash_eod(monkeypatch):
    members = [
        {"symbol": "AAA", "data_source": "yfinance", "country": "US"},
        {"symbol": "BBB", "data_source": "yfinance", "country": "US"},
    ]
    monkeypatch.setattr(prices, "_fetch_universe", lambda sb: members)
    monkeypatch.setattr(
        prices, "_ingest_yfinance_prices", lambda syms: [_bar("AAA")]
    )
    fetched: list[str] = []

    def fake_fetch(symbol, country=None, bars=10):
        fetched.append(symbol)
        return [object()], "stooq"

    import pipeline.clients.cash_eod as cash

    monkeypatch.setattr(cash, "fetch_daily_bars", fake_fetch)
    monkeypatch.setattr(cash, "bars_to_rows", lambda bars: [_bar("BBB")])

    run = _Run()
    prices._run_price_ingest(_SB(), run)

    assert fetched == ["BBB"]
    assert run.counts["upserted"] == 2
    assert run.partial is None


def test_fallback_is_capped(monkeypatch):
    members = [
        {"symbol": f"S{i}", "data_source": "yfinance", "country": "US"}
        for i in range(5)
    ]
    monkeypatch.setenv("PRICE_FALLBACK_MAX", "2")
    monkeypatch.setattr(prices, "_fetch_universe", lambda sb: members)
    monkeypatch.setattr(prices, "_ingest_yfinance_prices", lambda syms: [])
    fetched: list[str] = []

    def fake_fetch(symbol, country=None, bars=10):
        fetched.append(symbol)
        return [], "stooq"

    import pipeline.clients.cash_eod as cash

    monkeypatch.setattr(cash, "fetch_daily_bars", fake_fetch)
    monkeypatch.setattr(cash, "bars_to_rows", lambda bars: [_bar(fetched[-1])])

    prices._run_price_ingest(_SB(), _Run())
    assert len(fetched) == 2


def test_failed_upsert_batch_marks_run_partial(monkeypatch):
    monkeypatch.setattr(
        prices,
        "_fetch_universe",
        lambda sb: [{"symbol": "AAA", "data_source": "yfinance"}],
    )
    monkeypatch.setattr(
        prices, "_ingest_yfinance_prices", lambda syms: [_bar("AAA")]
    )
    run = _Run()
    prices._run_price_ingest(_SB(fail=True), run)
    assert run.partial and "upsert" in run.partial
