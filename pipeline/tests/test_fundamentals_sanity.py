from pipeline.ingest.fundamentals import _sanitize_margin_fields


def test_operating_margin_nulled_when_above_gross():
    row = _sanitize_margin_fields(
        {"gross_margin": 0.73, "operating_margin": 0.80, "net_margin": 0.5}
    )
    assert row["operating_margin"] is None
    assert row["gross_margin"] == 0.73


def test_percent_margins_normalized():
    row = _sanitize_margin_fields(
        {"gross_margin": 73, "operating_margin": 45, "net_margin": 30}
    )
    assert row["gross_margin"] == 0.73
    assert row["operating_margin"] == 0.45