from datetime import date

from pipeline.research.pit_universe import load_universe_symbols_as_of, symbols_from_snapshot_rows


def test_snapshot_rows_drop_inactive_pharma_and_non_us():
    rows = [
        {
            "symbol": "AAPL",
            "tier": "us_large",
            "sector": "Technology",
            "industry": "Consumer Electronics",
            "is_active": True,
        },
        {
            "symbol": "OLD",
            "tier": "us_large",
            "sector": "Technology",
            "industry": "Software",
            "is_active": False,
        },
        {
            "symbol": "MRNA",
            "tier": "us_nasdaq100",
            "sector": "Healthcare",
            "industry": "Biotechnology",
            "is_active": True,
        },
        {
            "symbol": "HSBA",
            "tier": "uk",
            "sector": "Financials",
            "industry": "Banks",
            "is_active": True,
        },
    ]
    assert symbols_from_snapshot_rows(rows) == ["AAPL"]


class _Result:
    def __init__(self, data):
        self.data = data


class _Table:
    def __init__(self, data):
        self._data = data

    def select(self, *_args, **_kwargs):
        return self

    def lte(self, *_args, **_kwargs):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def execute(self):
        return _Result(self._data)


class _SB:
    def __init__(self, responses):
        self._responses = list(responses)

    def table(self, _name):
        return _Table(self._responses.pop(0))


def test_load_universe_uses_snapshot_instead_of_live_scrape(monkeypatch):
    def _live():
        raise AssertionError("live index scrape must not run when a snapshot exists")

    monkeypatch.setattr("pipeline.research.pit_universe.build_merged_universe", _live)
    sb = _SB(
        [
            [{"asof_date": "2026-01-02"}],
            [
                {
                    "symbol": "MSFT",
                    "tier": "us_large",
                    "sector": "Technology",
                    "is_active": True,
                }
            ],
        ]
    )
    assert load_universe_symbols_as_of(sb, date(2026, 6, 1)) == ["MSFT"]
