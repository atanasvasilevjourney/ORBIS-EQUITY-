"""Cash EOD skips warrants / structured products instead of failing."""
from pipeline.universe_filters import is_structured_product_symbol


def test_warrant_symbols_are_structured():
    for sym in ("AACIW", "AACOW", "ABLVW", "ACAAW"):
        assert is_structured_product_symbol(sym)


def test_common_share_class_not_structured():
    assert not is_structured_product_symbol("BRK.B")
    assert not is_structured_product_symbol("AAPL")