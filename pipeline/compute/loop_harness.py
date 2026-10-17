"""Shared LOOP paper harness metadata (production Donchian entry + ATR trail exit)."""
from __future__ import annotations

from pipeline.compute.donchian_vwap import (
    ENTRY_CHANNEL,
    MAX_PER_SECTOR,
    REBALANCE_DAYS,
    TOP_N,
    VWAP_WINDOW,
)
from pipeline.compute.loop_atr_trail import LOOP_ATR_MULT, LOOP_ATR_PERIOD

PRODUCTION_EXIT_MODE = "atr_trail"


def loop_harness_config(**overrides: object) -> dict:
    cfg: dict = {
        "engine": "donchian_vwap_atr",
        "entryChannel": ENTRY_CHANNEL,
        "vwapWindow": VWAP_WINDOW,
        "exitMode": PRODUCTION_EXIT_MODE,
        "atrPeriod": LOOP_ATR_PERIOD,
        "atrMult": LOOP_ATR_MULT,
        "maxNames": TOP_N,
        "maxPerSector": MAX_PER_SECTOR,
        "rebalanceDays": REBALANCE_DAYS,
        "equalWeight": True,
    }
    cfg.update(overrides)
    return cfg
