from pipeline.compute.loop_xs_selection import (
    select_xs_targets,
    xs_eligible,
    xs_hard_exit,
    xs_trail_exit,
)


def test_xs_eligible_requires_on_list():
    assert xs_eligible({"state": 1, "quality_rank": 80, "z_mom": 5.0, "f_ewmac": 2.1})
    assert not xs_eligible({"state": 0, "quality_rank": 80, "z_mom": 5.0, "f_ewmac": 2.1})


def test_select_respects_sector_cap():
    rows = [
        {"symbol": "A", "state": 1, "quality_rank": 90, "z_mom": 5, "f_ewmac": 3, "convergence_count": 3},
        {"symbol": "B", "state": 1, "quality_rank": 85, "z_mom": 4, "f_ewmac": 2.5, "convergence_count": 2},
        {"symbol": "C", "state": 1, "quality_rank": 80, "z_mom": 4, "f_ewmac": 2, "convergence_count": 2},
    ]
    sector = {"A": "Tech", "B": "Tech", "C": "Energy"}
    picked = select_xs_targets(rows, sector, top_n=3, max_per_sector=1)
    assert picked == ["A", "C"]


def test_down_day_is_not_a_hard_exit():
    assert xs_hard_exit({"state": -1}) is None
    assert xs_hard_exit({"state": 1}) is None


def test_wide_trail_exit_requires_a_live_stop():
    assert xs_trail_exit(90.0, 0.0) is None
    assert xs_trail_exit(90.0, 100.0) is not None
    assert xs_trail_exit(101.0, 100.0) is None


def test_select_prefers_relative_strength_over_quality_rank():
    rows = [
        {
            "symbol": "WEAK",
            "state": 1,
            "quality_rank": 99,
            "z_mom": 5,
            "f_ewmac": 3,
            "convergence_count": 5,
            "rs_pct": 12,
        },
        {
            "symbol": "STRONG",
            "state": 1,
            "quality_rank": 61,
            "z_mom": 1,
            "f_ewmac": 0.2,
            "convergence_count": 1,
            "rs_pct": 96,
        },
    ]
    sector = {"WEAK": "Tech", "STRONG": "Energy"}
    assert select_xs_targets(rows, sector, top_n=1) == ["STRONG"]


def test_low_coverage_keeps_the_gapper_order():
    rows = [
        {
            "symbol": "NORANK",
            "state": 1,
            "quality_rank": 99,
            "z_mom": 5,
            "f_ewmac": 3,
            "convergence_count": 5,
        },
        {
            "symbol": "MEASURED",
            "state": 1,
            "quality_rank": 61,
            "z_mom": 1,
            "f_ewmac": 0.2,
            "convergence_count": 1,
            "rs_pct": 40,
        },
    ]
    sector = {"NORANK": "Tech", "MEASURED": "Energy"}
    assert select_xs_targets(rows, sector, top_n=2) == ["NORANK", "MEASURED"]


def test_full_coverage_admits_a_quiet_sector_leader():
    rows = [
        {
            "symbol": "GAP",
            "state": 1,
            "quality_rank": 99,
            "z_mom": 6,
            "f_ewmac": 3,
            "rs_pct": 10,
        },
        {
            "symbol": "QUIET",
            "state": 0,
            "quality_rank": 10,
            "z_mom": -1,
            "f_ewmac": 0.4,
            "rs_pct": 99,
        },
    ]
    sector = {"GAP": "Tech", "QUIET": "Energy"}
    assert select_xs_targets(rows, sector, top_n=1) == ["QUIET"]


def test_plus_four_day_breaks_an_rs_tie():
    rows = [
        {"symbol": "QUIET", "state": 0, "quality_rank": 80, "z_mom": 1, "f_ewmac": 1, "rs_pct": 80},
        {"symbol": "GAP", "state": 1, "quality_rank": 70, "z_mom": 5, "f_ewmac": 2, "rs_pct": 80},
    ]
    sector = {"QUIET": "Tech", "GAP": "Energy"}
    assert select_xs_targets(rows, sector, top_n=1) == ["GAP"]


def test_residual_eligibility_does_not_require_the_gapper_list():
    assert xs_eligible({"state": 0, "rs_pct": 55}, require_rs=True)
    assert not xs_eligible({"state": 1, "quality_rank": 90, "z_mom": 5, "f_ewmac": 2}, require_rs=True)
