"""Fast smoke test for LOOP v2 engine (synthetic panels)."""
from datetime import date

import numpy as np
import pandas as pd

from pipeline.research.loop_v2_backtest import LoopV2Config, run_loop_v2


def _synthetic_universe(n: int = 4) -> dict[str, pd.DataFrame]:
    idx = pd.bdate_range("2023-01-03", periods=120)
    panels: dict[str, pd.DataFrame] = {}
    rng = np.random.default_rng(0)
    for i in range(n):
        sym = f"SYM{i}"
        rets = rng.normal(0.0005, 0.01, len(idx))
        close = 50 * np.cumprod(1 + rets)
        panels[sym] = pd.DataFrame(
            {
                "open": close * 0.99,
                "high": close * 1.01,
                "low": close * 0.98,
                "close": close,
                "volume": rng.integers(1_000_000, 2_000_000, len(idx)),
            },
            index=idx,
        )
    spy_close = 400 + np.arange(len(idx))
    panels["SPY"] = pd.DataFrame(
        {
            "open": spy_close,
            "high": spy_close + 1,
            "low": spy_close - 1,
            "close": spy_close,
            "volume": np.full(len(idx), 50_000_000),
        },
        index=idx,
    )
    return panels


def test_loop_v2_runs_without_error():
    panels = _synthetic_universe()
    lookup = lambda d: {f"SYM{i}" for i in range(4)}  # noqa: ARG005
    cfg = LoopV2Config("smoke", use_vwap_entry=True, use_vwap_stop=True)
    daily, stats = run_loop_v2(
        date(2023, 3, 1),
        date(2023, 6, 1),
        config=cfg,
        panels=panels,
        sym_sector={f"SYM{i}": "Technology" for i in range(4)},
        membership_lookup=lookup,
    )
    assert len(daily) > 10
    assert "avg_holdings" in stats