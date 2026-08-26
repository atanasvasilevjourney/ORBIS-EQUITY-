"""Tests for EOD alert digest formatting / filtering."""
from datetime import date

from pipeline.notify.alert_digest import (
    filter_alert_rows,
    format_digest_html,
    format_digest_text,
    rows_to_candidates,
)


def _row(**kwargs):
    base = {
        "symbol": "AAA",
        "state": 1,
        "quality_rank": 70,
        "convergence_count": 5,
        "entry_timing": "ok",
        "breakout_active": False,
        "volume_confirmed": False,
        "kama_regime": 1,
        "adx": 25.0,
        "state_changed_at": "2026-08-26",
    }
    base.update(kwargs)
    return base


def test_filter_keeps_today_green_flips():
    as_of = date(2026, 8, 26)
    rows = [
        _row(symbol="KEEP"),
        _row(symbol="OLD", state_changed_at="2026-08-25"),
        _row(symbol="GREY", state=0),
        _row(symbol="LOW", quality_rank=50),
        _row(symbol="LATE", entry_timing="too_late"),
        _row(symbol="WAIT", entry_timing="wait_pullback"),
    ]
    kept = filter_alert_rows(rows, as_of=as_of, min_rank=60, min_convergence=4)
    symbols = [r["symbol"] for r in kept]
    assert symbols == ["KEEP", "WAIT"]


def test_filter_can_skip_wait_pullback():
    as_of = date(2026, 8, 26)
    rows = [_row(symbol="WAIT", entry_timing="wait_pullback")]
    kept = filter_alert_rows(
        rows, as_of=as_of, skip_wait_pullback=True
    )
    assert kept == []


def test_format_digest_includes_symbols():
    cands = rows_to_candidates(
        [_row(symbol="XOM", quality_rank=82)],
        {"XOM": {"company_name": "Exxon", "sector": "Energy"}},
    )
    text = format_digest_text(cands, as_of=date(2026, 8, 26), app_base_url="https://app.test")
    assert "XOM" in text
    assert "Exxon" in text
    assert "https://app.test/ticker/XOM" in text
    html = format_digest_html(cands, as_of=date(2026, 8, 26))
    assert "XOM" in html
    assert "82" in html


def test_empty_digest():
    text = format_digest_text([], as_of=date(2026, 8, 26))
    assert "No qualifying" in text
