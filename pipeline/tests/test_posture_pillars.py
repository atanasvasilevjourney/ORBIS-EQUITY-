from pipeline.compute.aggregates import radar_aux_pillars


def test_aux_pillars_include_participation():
    rows = [{"quality_rank": 80}, {"quality_rank": 40}, {"quality_rank": 75}, {"quality_rank": 30}]
    breadth = {"advancers_pct": 50.0, "pct_green": 25.0}
    p = radar_aux_pillars(breadth, rows, avg_rank=56.0)
    assert p["participation"] == 25
    assert p["leadership"] == 50
    assert 15 <= p["heat_cap_pct"] <= 100