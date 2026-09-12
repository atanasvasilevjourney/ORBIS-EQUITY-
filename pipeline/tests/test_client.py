"""Tests for pipeline.utils.client env validation."""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _clear_client_cache():
    from pipeline.utils import client as c

    c.get_supabase.cache_clear()
    yield
    c.get_supabase.cache_clear()


def test_reject_placeholder_host(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv(
        "SUPABASE_SERVICE_KEY",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlc3QiLCJyb2xlIjoic2VydmljZV9yb2xlIn0.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    )
    from pipeline.utils.client import require_supabase_env

    with pytest.raises(RuntimeError, match="placeholder"):
        require_supabase_env()


def test_reject_short_key(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://abcdefghijklmnop.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "short")
    from pipeline.utils.client import require_supabase_env

    with pytest.raises(RuntimeError, match="placeholder"):
        require_supabase_env()


def test_accept_real_looking_credentials(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://abcdefghijklmnop.supabase.co")
    monkeypatch.setenv(
        "SUPABASE_SERVICE_KEY",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlc3QiLCJyb2xlIjoic2VydmljZV9yb2xlIn0.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    )
    monkeypatch.delenv("NEXT_PUBLIC_SUPABASE_URL", raising=False)
    from pipeline.utils.client import require_supabase_env

    url, key = require_supabase_env()
    assert "abcdefghijklmnop" in url
    assert len(key) >= 40
