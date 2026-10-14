"""CLI: python -m pipeline.research_framework.jobs.weekly"""
from __future__ import annotations

import logging

from pipeline.research_framework.generate_weekly import generate_pack, load_config, persist_pack
from pipeline.utils.run_recorded import run_recorded


def _body(sb, _rec) -> None:
    cfg = load_config()
    pack = generate_pack(sb, cfg)
    persist_pack(sb, pack)


if __name__ == "__main__":
    run_recorded("research_framework.weekly", _body)
