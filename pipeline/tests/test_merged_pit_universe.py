from datetime import date

from pipeline.research.merged_pit_universe import dedupe_share_classes, merged_symbols_as_of


def test_dedupe_drops_goog_keeps_googl():
    out = dedupe_share_classes({"GOOG", "GOOGL", "AAPL"})
    assert out == {"GOOGL", "AAPL"}


def test_merged_union_includes_sp500_and_ndx(monkeypatch):
    monkeypatch.setattr(
        "pipeline.research.merged_pit_universe.sp_lookup",
        lambda _p: (lambda d: {"AAPL", "MSFT", "GOOG"}),
    )
    monkeypatch.setattr(
        "pipeline.research.merged_pit_universe.ndx_lookup",
        lambda _p: (lambda d: {"GOOGL", "NVDA"}),
    )
    sym = merged_symbols_as_of(date(2020, 1, 2))
    assert "AAPL" in sym
    assert "NVDA" in sym
    assert "GOOG" not in sym
    assert "GOOGL" in sym