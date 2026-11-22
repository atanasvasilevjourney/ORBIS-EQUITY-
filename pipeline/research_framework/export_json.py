"""Serialize weekly research pack to a repo JSON artifact."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PATH = REPO_ROOT / "public" / "artifacts" / "research-weekly-latest.json"
ALT_PATH = Path(__file__).resolve().parent / "output" / "latest.json"


def _idea_public(idea: dict[str, Any]) -> dict[str, Any]:
    return {
        "ticker": idea.get("symbol"),
        "direction": idea.get("direction") or idea.get("side"),
        "horizon": idea.get("horizon"),
        "entry_zone": idea.get("entry_zone") or idea.get("meta", {}).get("entry_zone"),
        "entry": idea.get("entry_px"),
        "stop_invalidation": idea.get("stop_px"),
        "target": idea.get("target_px"),
        "confidence": idea.get("confidence"),
        "rationale": idea.get("rationale"),
        "sources": idea.get("sources") or idea.get("meta", {}).get("sources") or [],
        "wrong_test": idea.get("wrong_test") or idea.get("meta", {}).get("wrong_test"),
        "meta": idea.get("meta") or {},
        "company_name": idea.get("company_name"),
        "theme": idea.get("theme"),
        "rr": idea.get("rr"),
        "last": idea.get("last_px"),
    }


def pack_to_document(pack: dict[str, Any], *, run_id: str | None = None) -> dict[str, Any]:
    ideas = pack.get("ideas") or pack.get("setups") or []
    horizons = pack.get("horizons") or {}
    if not horizons and ideas:
        from pipeline.research_framework.ideas import ideas_by_horizon

        horizons = ideas_by_horizon(ideas)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "run_id": run_id,
        "week_ending": pack.get("week_ending"),
        "headline": pack.get("headline"),
        "macro": pack.get("macro"),
        "sectors": pack.get("sectors"),
        "risk_notes": pack.get("risk_notes"),
        "ideas": [_idea_public(i) for i in ideas],
        "setups": [_idea_public(i) for i in ideas],
        "horizons": {k: [_idea_public(i) for i in v] for k, v in horizons.items()},
        "shorts": [_idea_public(i) for i in (pack.get("shorts") or [])],
    }


def write_pack_json(pack: dict[str, Any], path: Path | None = None, *, run_id: str | None = None) -> Path:
    target = path or DEFAULT_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    doc = pack_to_document(pack, run_id=run_id)
    target.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    ALT_PATH.parent.mkdir(parents=True, exist_ok=True)
    ALT_PATH.write_text(target.read_text(encoding="utf-8"), encoding="utf-8")
    return target