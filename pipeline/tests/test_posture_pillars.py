from pipeline.compute.aggregates import compute_posture_pillars


def test_pillars_include_guidance_and_heat_cap():
    rows = [{"quality_rank": 80}, {"quality_rank": 40}, {"quality_rank": 75}, {"quality_rank": 30}]
    breadth = {"advancers_pct": 50.0, "pct_green": 25.0}
    p = compute_posture_pillars(breadth, rows, avg_rank=56.0)
    assert p["trend"] == 56
    assert p["breadth"] == 50
    assert p["leadership"] == 50
    assert p["participation"] == 25
    assert 15 <= p["heat_cap_pct"] <= 100
    assert isinstance(p["guidance"], str)
