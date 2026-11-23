"""PostgREST / Postgres errors — missing tables and columns on hosted Supabase."""
from __future__ import annotations

from typing import Any


def error_text(err: Any) -> str:
    if not err:
        return ""
    if isinstance(err, str):
        return err
    if isinstance(err, dict):
        return " ".join(
            str(err.get(k) or "")
            for k in ("code", "message", "details", "hint")
            if err.get(k)
        )
    code = getattr(err, "code", None)
    msg = getattr(err, "message", None) or str(err)
    if code:
        return f"{code} {msg}"
    return msg


def is_missing_relation(err: Any) -> bool:
    code = ""
    if isinstance(err, dict):
        code = str(err.get("code") or "")
    else:
        code = str(getattr(err, "code", "") or "")
    if code in ("PGRST205", "42P01"):
        return True
    text = error_text(err)
    if "column " in text.lower():
        return False
    lowered = text.lower()
    return (
        "could not find the table" in lowered
        or "schema cache" in lowered
        or "does not exist" in lowered and "relation" in lowered
    )


def is_missing_column(err: Any) -> bool:
    code = ""
    if isinstance(err, dict):
        code = str(err.get("code") or "")
    else:
        code = str(getattr(err, "code", "") or "")
    if code in ("42703", "PGRST204"):
        return True
    return "column " in error_text(err).lower() and "does not exist" in error_text(err).lower()