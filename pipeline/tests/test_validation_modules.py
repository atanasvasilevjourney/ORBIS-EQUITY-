"""Each trading module returns a finite equity curve on the synthetic tape."""
import math

import pytest

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
