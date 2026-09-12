"""Unit tests for pipeline.data.sponsor_map seed data."""
from pipeline.data.sponsor_map import SPONSOR_TICKER_MAP


class TestSponsorMap:
    def test_map_not_empty(self):
        assert len(SPONSOR_TICKER_MAP) > 0

    def test_all_entries_have_required_fields(self):
        for entry in SPONSOR_TICKER_MAP:
            assert "sponsor_name" in entry
            assert "ticker" in entry
            assert "exchange" in entry
            assert entry["sponsor_name"]
            assert entry["ticker"]

    def test_pfizer_mapping(self):
        pfizer = next(e for e in SPONSOR_TICKER_MAP if e["ticker"] == "PFE")
        assert pfizer["sponsor_name"] == "Pfizer"
        assert "Pfizer Inc." in pfizer.get("aliases", [])

    def test_tickers_unique(self):
        tickers = [e["ticker"] for e in SPONSOR_TICKER_MAP]
        # Some companies may share tickers via aliases but sponsor names differ
        assert len(tickers) == len(set(tickers))

    def test_aliases_are_lists(self):
        for entry in SPONSOR_TICKER_MAP:
            aliases = entry.get("aliases", [])
            assert isinstance(aliases, list)
