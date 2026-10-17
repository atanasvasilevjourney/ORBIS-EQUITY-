from datetime import date

from pipeline.notify.research_weekly_digest import format_digest_html, format_digest_text


def test_format_digest_text_includes_setups_and_watchlist():
    run = {
        "headline": "Test headline",
        "macro": {"headline": "SPY above MA200", "narrative": ["Line one"]},
        "risk_notes": ["Entry must trigger."],
    }
    setups = [
        {
            "symbol": "AAPL",
            "entry_px": 100,
            "stop_px": 95,
            "target_px": 110,
            "rr": 2.0,
            "theme": "Tech",
            "rationale": "ORBIS rank",
        }
    ]
    watchlist = [
        {
            "symbol": "MSFT",
            "quality_rank": 80,
            "convergence_count": 4,
            "entry_timing": "ok",
            "company_name": "Microsoft",
        }
    ]
    text = format_digest_text(
        as_of=date(2026, 10, 12),
        run=run,
        setups=setups,
        watchlist=watchlist,
        app_base="https://app.example.com",
    )
    assert "AAPL" in text
    assert "MSFT" in text
    html = format_digest_html(
        as_of=date(2026, 10, 12),
        run=run,
        setups=setups,
        watchlist=watchlist,
        app_base="https://app.example.com",
    )
    assert "AAPL" in html
    assert "Watchlist leaders" in html
