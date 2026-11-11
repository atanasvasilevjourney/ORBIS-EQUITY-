"""Each trading module returns a finite equity curve on the synthetic tape."""
import math

import numpy as np
import pytest

from pipeline.research.validation.metrics import apply_turnover
from pipeline.research.validation.modules import RUNNERS
from pipeline.research.validation.panel import synthetic_panel

PANEL = synthetic_panel(n_days=260, seed=7)


@pytest.mark.parametrize("name", sorted(RUNNERS))
def test_module_run_is_finite(name: str):
    run = RUNNERS[name](PANEL)
    assert run.module_id
    assert run.rules
    assert len(run.equity) > 50
    assert math.isfinite(float(run.equity.iloc[-1]))
    assert math.isfinite(run.metrics["sharpe"])
    assert math.isfinite(run.metrics["max_drawdown_pct"])


def test_persistent_bias_is_not_a_daily_round_trip():
    """A stance that stays on is one spell, not a fresh trade every session."""
    run = RUNNERS["daily_bias"](PANEL)
    assert run.metrics["n_trades"] < 800


def test_turnover_charges_entry_and_exit():
    weight = np.array([1.0, 1.0, 0.0])
    bar = np.array([0.0, 0.0, 0.0])
    out = apply_turnover(weight, bar)
    assert out[0] < 0
    assert out[1] == 0
    assert out[2] < 0
