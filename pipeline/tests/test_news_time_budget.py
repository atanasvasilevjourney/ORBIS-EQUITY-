"""Unit tests for news ingest time budget."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pipeline.ingest.news as news_mod


def test_news_stops_when_max_sec_exceeded(monkeypatch):
    monkeypatch.setenv("NEWS_MAX_SEC", "0.01")
    tickers = ["AAA", "BBB", "CCC"]
    sb = MagicMock()

    times = iter([0.0, 0.005, 0.02])

    def fake_monotonic():
        return next(times, 999.0)

    with patch.object(news_mod, "_get_priority_tickers", return_value=tickers):
        with patch.object(news_mod, "_fetch_articles_for_ticker", return_value=([], "none")):
            with patch.object(news_mod.time, "monotonic", fake_monotonic):
                stats = news_mod.run_news_ingest(sb)

    assert stats["stopped_early"] is True
    assert stats["tickers"] == 3