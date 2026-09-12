"""Shared Supabase client + env validation for the Orbis Equity pipeline."""
from __future__ import annotations

import os
import re
from functools import lru_cache
from typing import Any

from pipeline.config.settings import SupabaseConfig

_PLACEHOLDER_HOSTS = (
    "example.supabase.co",
    "your-project.supabase.co",
    "placeholder.supabase.co",
)


def _looks_placeholder(url: str, key: str) -> str | None:
    """Return a human reason if credentials look like placeholders."""
    host = re.sub(r"^https?://", "", (url or "").strip()).split("/")[0].lower()
    if not url or not key:
        return "SUPABASE_URL and SUPABASE_SERVICE_KEY are required"
    if host in _PLACEHOLDER_HOSTS or host.startswith("example."):
        return f"SUPABASE_URL looks like a placeholder ({host})"
    if "your_service" in key.lower() or key.endswith("placeholder") or len(key) < 40:
        return "SUPABASE_SERVICE_KEY looks like a placeholder (too short or template value)"
    return None


def require_supabase_env() -> tuple[str, str]:
    """Resolve and validate Supabase credentials. Raises RuntimeError if unusable."""
    cfg = SupabaseConfig()
    url = cfg.url or os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
    key = (
        cfg.service_key
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        or os.getenv("SUPABASE_SERVICE_KEY", "")
    )
    reason = _looks_placeholder(url, key)
    if reason:
        raise RuntimeError(
            f"{reason}. Set real values in Render env group `orbis-equity-pipeline`, "
            "GitHub Actions secrets, and Vercel. See DEPLOY.md."
        )
    return url, key


@lru_cache(maxsize=1)
def get_supabase() -> Any:
    """Cached service-role Supabase client for pipeline writers."""
    from supabase import create_client

    url, key = require_supabase_env()
    return create_client(url, key)
