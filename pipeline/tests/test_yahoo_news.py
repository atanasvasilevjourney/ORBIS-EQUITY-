from pipeline.clients.yahoo_news import fetch_yahoo_news_for_ticker


def test_fetch_yahoo_news_parses_nested_content(monkeypatch):
    sample = [
        {
            "content": {
                "title": "Test headline",
                "pubDate": "2025-11-20T10:00:00Z",
                "provider": {"displayName": "Reuters"},
                "canonicalUrl": {"url": "https://example.com/story"},
            }
        }
    ]

    class FakeTicker:
        news = sample

    class FakeYf:
        def Ticker(self, _):
            return FakeTicker()

    monkeypatch.setitem(__import__("sys").modules, "yfinance", FakeYf())
    rows = fetch_yahoo_news_for_ticker("AAPL", max_records=5)
    assert len(rows) == 1
    assert rows[0]["title"] == "Test headline"
    assert rows[0]["url"] == "https://example.com/story"