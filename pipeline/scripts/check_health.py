#!/usr/bin/env python3
"""Pipeline health check — env, connectivity, and core table freshness.

Usage:
    python -m pipeline.scripts.check_health
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime, timezone


def main() -> int:
    from pipeline.utils.client import get_supabase, require_supabase_env

    report: dict = {"ok": True, "checks": []}

    def add(name: str, ok: bool, detail: str) -> None:
        report["checks"].append({"name": name, "ok": ok, "detail": detail})
        if not ok:
            report["ok"] = False

    try:
        url, _ = require_supabase_env()
        add("env", True, f"credentials look real ({url})")
    except RuntimeError as exc:
        add("env", False, str(exc))
        print(json.dumps(report, indent=2))
        return 1

    try:
        sb = get_supabase()
        # Cheap auth/connectivity probe
        sb.table("universe_members").select("symbol").limit(1).execute()
        add("connectivity", True, "PostgREST reachable with service key")
    except Exception as exc:
        add("connectivity", False, f"{type(exc).__name__}: {exc}")
        print(json.dumps(report, indent=2))
        return 1

    core = [
        ("universe_members", None),
        ("prices_daily", "date"),
        ("fundamentals_snapshot", None),
        ("trend_radar", None),
        ("daily_brief", "asof_date"),
    ]
    today = date.today()
    for table, date_col in core:
        try:
            resp = sb.table(table).select("*", count="exact").limit(0).execute()
            count = resp.count or 0
            fresh = None
            if date_col and count:
                latest = (
                    sb.table(table)
                    .select(date_col)
                    .order(date_col, desc=True)
                    .limit(1)
                    .execute()
                )
                if latest.data:
                    raw = latest.data[0].get(date_col)
                    fresh = str(raw)
                    try:
                        d = date.fromisoformat(str(raw)[:10])
                        age = (today - d).days
                        if age > 5:
                            add(table, False, f"count={count} latest={fresh} age_days={age} (stale)")
                            continue
                    except ValueError:
                        pass
            ok = count > 0
            detail = f"count={count}" + (f" latest={fresh}" if fresh else "")
            if not ok:
                detail += " — run bootstrap"
            add(table, ok, detail)
        except Exception as exc:
            add(table, False, f"{type(exc).__name__}: {exc}")

    report["checked_at"] = datetime.now(timezone.utc).isoformat()
    print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 2


if __name__ == "__main__":
    sys.exit(main())
