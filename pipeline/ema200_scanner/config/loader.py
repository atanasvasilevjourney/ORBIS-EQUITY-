"""Load EMA200 scanner YAML config (single source for thresholds)."""
from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

_DEFAULT_PATH = Path(__file__).resolve().parent / "ema200_scanner.yaml"


def _deep_freeze(obj: Any) -> Any:
    if isinstance(obj, dict):
        return tuple(sorted((k, _deep_freeze(v)) for k, v in obj.items()))
    if isinstance(obj, list):
        return tuple(_deep_freeze(x) for x in obj)
    return obj


def config_hash(cfg: dict[str, Any]) -> str:
    """Stable hash of config for alert footers and reproducibility."""
    payload = json.dumps(_deep_freeze(cfg), sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


@lru_cache(maxsize=1)
def load_config(path: str | None = None) -> dict[str, Any]:
    cfg_path = Path(path) if path else _DEFAULT_PATH
    with cfg_path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    if not isinstance(data, dict):
        raise ValueError(f"Invalid config at {cfg_path}: expected mapping")
    return data
