"""Cross-sectional factor ranks: one scale per input, blanks stay blank."""
from __future__ import annotations

import numpy as np

from pipeline.compute.factor_scores import percentile_ranks, score_cross_section


def _row(**kwargs) -> dict:
    return kwargs


def test_yield_only_does_not_outrank_a_complete_cheap_name():
    """The old mean of −P/E and yields ranked a yield-only name first."""
    rows = [
        _row(pe_ratio=10, pb_ratio=2, ev_ebitda=8, earnings_yield=0.10, fcf_yield=0.06),
        _row(pe_ratio=40, pb_ratio=12, ev_ebitda=25, earnings_yield=0.025, fcf_yield=0.01),
        _row(earnings_yield=0.04, fcf_yield=0.03),
    ]
    scored = score_cross_section(rows, [None, None, None], [None, None, None], ["X", "X", "X"])
    cheap, rich, yield_only = scored["value"]
    assert cheap == 100
    assert rich == 0
    assert yield_only == 50
    assert yield_only < cheap
    assert rich < yield_only


def test_missing_value_inputs_stay_missing():
    rows = [
        _row(pe_ratio=10),
        _row(pe_ratio=10),
        _row(),
    ]
    scored = score_cross_section(
        rows, [None, None, None], [None, None, None], ["Tech", "Tech", "Tech"]
    )
    assert scored["value"][0] == scored["value"][1] == 50
    assert np.isnan(scored["value"][2])
    assert np.isnan(scored["composite"][2])


def test_identical_inputs_share_one_rank():
    values = np.array([1.0, 1.0, 3.0])
    ranks = percentile_ranks(values, higher_is_better=True)
    assert ranks[0] == ranks[1]
    assert ranks[2] == 100
    assert ranks[0] < ranks[2]


def test_rank_does_not_depend_on_row_order_of_ties():
    forward = percentile_ranks(np.array([5.0, 5.0, 5.0, 9.0]))
    shuffled = percentile_ranks(np.array([5.0, 9.0, 5.0, 5.0]))
    assert forward[0] == shuffled[0] == shuffled[2] == shuffled[3]
    assert forward[3] == shuffled[1] == 100


def test_sound_balance_sheet_beats_coverage_dominated_leverage():
    """Interest coverage used to set the raw mean because it lives near 40, not 2."""
    rows = [
        _row(current_ratio=2.0, debt_to_equity=0.4),
        _row(current_ratio=1.2, debt_to_equity=3.0),
    ]
    scored = score_cross_section(rows, [None, None], [8.0, 40.0], ["X", "X"])
    assert scored["leverage"][0] > scored["leverage"][1]


def test_composite_renormalizes_when_a_style_is_missing():
    rows = [_row(pe_ratio=10), _row(pe_ratio=40)]
    scored = score_cross_section(rows, [None, None], [None, None], ["X", "X"])
    assert scored["composite"][0] == 100
    assert scored["composite"][1] == 0
    assert np.isnan(scored["quality"][0])


def test_sector_rank_leaves_a_blank_name_blank():
    rows = [
        _row(pe_ratio=10),
        _row(pe_ratio=20),
        _row(pe_ratio=30),
        _row(),
    ]
    sectors = ["Tech", "Tech", "Tech", "Tech"]
    scored = score_cross_section(rows, [None] * 4, [None] * 4, sectors)
    assert scored["sector_value"][0] == 100
    assert scored["sector_value"][1] == 50
    assert scored["sector_value"][2] == 0
    assert np.isnan(scored["sector_value"][3])


def test_single_observation_is_neutral_not_a_top_score():
    ranks = percentile_ranks(np.array([0.2, np.nan]))
    assert ranks[0] == 50
    assert np.isnan(ranks[1])
