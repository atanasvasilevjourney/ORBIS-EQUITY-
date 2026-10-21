"""ORB size is notional, and the bracket is one opening range either side."""
from pipeline.compute.opening_range import or_bracket, paper_shares


def test_five_percent_of_equity_is_notional_shares():
    # $100k × 5% / $50 = 100 shares. Dollar risk is the opening range, not 5%.
    assert paper_shares(50) == 100
    assert paper_shares(0) is None
    assert paper_shares(100_000 * 0.05 + 1) is None


def test_bracket_is_one_range_around_entry():
    stop, target = or_bracket(100, 2)
    assert stop == 98
    assert target == 102
