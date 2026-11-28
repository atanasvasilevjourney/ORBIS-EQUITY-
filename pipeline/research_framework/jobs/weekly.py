"""CLI: python -m pipeline.research_framework.jobs.weekly"""
from __future__ import annotations

import logging
import sys

from pipeline.research_framework.export_json import write_pack_json
from pipeline.research_framework.generate_weekly import generate_pack, load_config, persist_pack
from pipeline.research_framework.schema_preflight import ResearchWeeklySchemaError
from pipeline.utils.run_recorded import run_recorded

logger = logging.getLogger(__name__)


def _body(sb, _rec) -> None:
    cfg = load_config()
    pack = generate_pack(sb, cfg)
    run_id = persist_pack(sb, pack)
    write_pack_json(pack, run_id=run_id)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    try:
        run_recorded("research_framework.weekly", _body)
    except ResearchWeeklySchemaError as exc:
        logger.error("%s", exc)
        raise SystemExit(1) from exc
