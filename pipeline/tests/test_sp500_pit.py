from datetime import date

from pipeline.research.sp500_pit import _parse_ticker_token, symbols_as_of


def test_parse_delisted_suffix():
    assert _parse_ticker_token("AAMRQ-201312") == "AAMRQ"
    assert _parse_ticker_token("AAPL") == "AAPL"


def test_symbols_as_of_nonempty():
    syms = symbols_as_of(date(2010, 6, 1))
    assert "AAPL" in syms
    assert len(syms) > 400