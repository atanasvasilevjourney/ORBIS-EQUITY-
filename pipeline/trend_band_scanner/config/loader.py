from __future__ import annotations

from pathlib import Path

import yaml

_CFG = Path(__file__).resolve().parent / "trend_band_scanner.yaml"


def load_config() -> dict:
    with open(_CFG, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}