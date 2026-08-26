"""Wide SMA20 trailing exit + consecutive-loss cooldown (from Edge-Swing v3.2).

Design notes from their iteration log:
  - Tight % trails and tiered tighten-on-profit choke fat tails.
  - Wide trail: max(-7% from peak, SMA20); after +10% profit, SMA20 only.
  - Move stop to breakeven at +3%.
  - After 2 consecutive realized losses, skip the next setup (cooldown).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

BE_TRIGGER_PCT = 0.03           # +3% → stop to breakeven
TRAIL_PCT = 0.07                # −7% from peak (breathing room)
SMA_ONLY_PROFIT_PCT = 0.10      # after +10%, trail SMA20 only
COOLDOWN_AFTER_LOSSES = 2


@dataclass
class TrailState:
    entry_price: float
    current_sl: float
    peak_price: float
    be_active: bool = False
    trail_active: bool = False

    def update(self, high: float, close: float, sma20: float) -> float:
        """Update peak / trail stop; return new stop price."""
        if np.isfinite(high) and high > self.peak_price:
            self.peak_price = float(high)

        profit_pct = (close / self.entry_price) - 1.0 if self.entry_price > 0 else 0.0

        if not self.be_active and profit_pct >= BE_TRIGGER_PCT:
            self.be_active = True
            self.current_sl = max(self.current_sl, self.entry_price)

        if profit_pct >= BE_TRIGGER_PCT:
            self.trail_active = True

        if self.trail_active and np.isfinite(sma20) and sma20 > 0:
            if profit_pct >= SMA_ONLY_PROFIT_PCT:
                new_sl = float(sma20)
            else:
                pct_trail = self.peak_price * (1.0 - TRAIL_PCT)
                new_sl = max(pct_trail, float(sma20))
            self.current_sl = max(self.current_sl, new_sl)

        return self.current_sl


@dataclass
class CooldownTracker:
    """Skip next entry after N consecutive losing exits."""

    consecutive_losses: int = 0
    skip_next: bool = False
    losses_needed: int = COOLDOWN_AFTER_LOSSES

    def on_entry_attempt(self) -> bool:
        """Return True if entry is allowed; consume a cooldown skip if armed."""
        if self.skip_next:
            self.skip_next = False
            return False
        return True

    def on_exit(self, return_pct: float) -> None:
        if return_pct < 0:
            self.consecutive_losses += 1
            if self.consecutive_losses >= self.losses_needed:
                self.skip_next = True
                self.consecutive_losses = 0
        else:
            self.consecutive_losses = 0
