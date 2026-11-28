from pipeline.utils.market_cap import normalize_market_cap_usd


def test_fico_like_millions_not_trillions():
    # Vendor sometimes stores ~16311 (millions USD) but >=1e9 path must not 16T it.
    mcap = normalize_market_cap_usd(16311, price=1800)
    assert mcap is not None
    assert mcap < 5e12
    assert 1e10 < mcap < 2e11