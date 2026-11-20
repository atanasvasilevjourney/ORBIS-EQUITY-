import pandas as pd

from pipeline.clients.yahoo_earnings import earnings_dates_to_rows
from pipeline.ingest.earnings import map_lse_earnings, merge_earnings_rows as merge_rows


def test_earnings_dates_to_rows():
    df = pd.DataFrame(
        {
            "EPS Estimate": [1.0, 2.0],
            "Reported EPS": [1.1, None],
            "Surprise(%)": [10.0, None],
        },
        index=pd.to_datetime(["2025-01-15", "2025-04-15"]),
    )
    rows = earnings_dates_to_rows("AAPL", df)
    assert len(rows) == 2
    assert rows[0]["ticker"] == "AAPL"
    assert rows[0]["source"] == "yahoo"
    assert rows[0]["confirmed"] is True
    assert rows[0]["event_date"] == "2025-01-15"
    assert rows[1]["confirmed"] is False


def test_merge_prefers_lse():
    lse = [{"ticker": "AAPL", "event_date": "2025-01-15", "source": "lse", "eps_est": 1.0}]
    yahoo = [{"ticker": "AAPL", "event_date": "2025-01-15", "source": "yahoo", "eps_est": 0.9}]
    merged = merge_rows(lse, yahoo)
    assert len(merged) == 1
    assert merged[0]["source"] == "lse"


def test_map_lse_filters_universe():
    raw = [
        {"symbol": "AAPL", "event_date": "2025-01-01", "eps_estimated": 1.0, "eps_actual": 1.1},
        {"symbol": "JUNK", "event_date": "2025-01-01", "eps_estimated": 1.0},
    ]
    rows = map_lse_earnings(raw, {"AAPL"})
    assert len(rows) == 1
    assert rows[0]["source"] == "lse"