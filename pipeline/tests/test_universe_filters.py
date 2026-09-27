from pipeline.universe_filters import is_loop_tradable, is_pharma_stock


def test_pharma_by_industry():
    assert is_pharma_stock({"industry": "Pharmaceuticals", "sector": "Health Care"})
    assert is_pharma_stock({"industry": "Biotechnology", "sector": "Health Care"})
    assert not is_pharma_stock({"industry": "Health Care Equipment", "sector": "Health Care"})


def test_loop_tradable():
    assert is_loop_tradable(
        {"tier": "us_large", "is_active": True, "industry": "Software", "sector": "Technology"}
    )
    assert not is_loop_tradable(
        {"tier": "us_large", "is_active": True, "industry": "Pharmaceuticals", "sector": "Health Care"}
    )
    assert not is_loop_tradable(
        {"tier": "uk", "is_active": True, "industry": "Software", "sector": "Technology"}
    )
