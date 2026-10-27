from pipeline.compute.loop_xs_selection import select_xs_targets, xs_eligible, xs_hard_exit


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


def test_hard_exit_on_down_day():
    assert xs_hard_exit({"state": -1}) is not None
    assert xs_hard_exit({"state": 1}) is None


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


def test_missing_rs_sorts_after_measured_names():
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
    assert select_xs_targets(rows, sector, top_n=2) == ["MEASURED", "NORANK"]
