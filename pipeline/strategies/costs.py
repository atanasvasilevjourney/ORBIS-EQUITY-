from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CostModel:
    """Paper-book defaults: 5 bps commission + 5 bps slippage per side (10 bps total)."""

    commission_bps: float = 5.0
    slippage_bps: float = 5.0

    @property
    def bps_per_side(self) -> float:
        return self.commission_bps + self.slippage_bps


DEFAULT_LOOP_COSTS = CostModel()
