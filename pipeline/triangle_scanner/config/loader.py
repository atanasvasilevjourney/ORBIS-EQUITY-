from __future__ import annotations

import hashlib
from pathlib import Path

import yaml

_CONFIG_PATH = Path(__file__).resolve().parent / "triangle_scanner.yaml"
_cached: dict | None = None
_cached_hash: str | None = None


def load_config() -> dict:
    global _cached, _cached_hash
    raw = _CONFIG_PATH.read_text(encoding="utf-8")
    h = hashlib.sha256(raw.encode()).hexdigest()[:16]
    if _cached is not None and _cached_hash == h:
        return _cached
    data = yaml.safe_load(raw) or {}
    _cached = data
    _cached_hash = h
    return data


def config_hash() -> str:
    load_config()
    return _cached_hash or ""
