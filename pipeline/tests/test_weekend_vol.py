"""Friday-to-Monday variance gap used by the skew desk."""
from pipeline.compute.skew_map import weekend_from_term


def test_weekend_variance_is_monday_minus_friday():
    term = [
        {"expiry": "2026-10-16", "dte": 2, "weekday": 4, "atmIv": 0.20},
        {"expiry": "2026-10-19", "dte": 5, "weekday": 0, "atmIv": 0.25},
    ]
    out = weekend_from_term(term)
    assert out is not None
    t_f = 2 / 365.0
    t_m = 5 / 365.0
    var_f = (0.20 ** 2) * t_f
    var_m = (0.25 ** 2) * t_m
    assert out["varFriday"] == round(var_f, 8)
    assert out["varMonday"] == round(var_m, 8)
    assert out["varWeekend"] == round(var_m - var_f, 8)
    assert out["weekendRatio"] > 1


def test_weekend_is_missing_without_a_monday_expiry():
    term = [{"expiry": "2026-10-16", "dte": 2, "weekday": 4, "atmIv": 0.20}]
    assert weekend_from_term(term) is None
