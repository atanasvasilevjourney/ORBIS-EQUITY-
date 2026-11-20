from pipeline.universe_filters import (
    is_loop_tradable,
    is_pharma_stock,
    is_research_desk_eligible,
    is_structured_product_symbol,
)


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


def test_structured_symbols():
    assert is_structured_product_symbol("AACPU")
    assert is_structured_product_symbol("AAPLW")
    assert not is_structured_product_symbol("AAPL")
    assert not is_structured_product_symbol("NVDA")


def test_research_desk_filters_junk():
    assert is_research_desk_eligible(
        {"symbol": "MSFT", "tier": "us_large", "is_active": True, "company_name": "Microsoft", "sector": "Technology"}
    )
    assert not is_research_desk_eligible(
        {"symbol": "AACPU", "tier": "us_nasdaq100", "is_active": True, "company_name": "AC Corp Unit", "sector": "Financials"}
    )
    assert not is_research_desk_eligible(
        {"symbol": "XYZ", "tier": "us_nasdaq_listed", "is_active": True, "company_name": "XYZ Inc", "sector": "Tech"}
    )
