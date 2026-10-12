"""Prop-firm challenge overlay on a daily equity return series.

Maps KovaView backtest / paper daily returns onto simplified challenge rules
(daily loss cap, max loss, profit target). Firm-specific nuance (balance vs
equity at midnight, news rules, lot limits) must be configured manually —
this is a research harness, not a compliance engine.

Usage:
    PYTHONPATH=. python -m pipeline.research.prop_challenge_sim \\
        --returns-csv path/to/daily_returns.csv
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass

import numpy as np

BARS_PER_YEAR = 252.0


@dataclass(frozen=True)
class PropRules:
    """Typical 2-step prop challenge (verify against your provider)."""

    initial_balance: float = 100_000.0
    max_daily_loss_pct: float = 0.05  # of initial balance (FTMO-style floor)
    max_total_loss_pct: float = 0.10  # of initial
    profit_target_pct: float = 0.10  # phase-1 target
    min_trading_days: int = 4
    # Count a day as "traded" when |daily return| > this threshold
    traded_day_abs_return: float = 1e-6


@dataclass(frozen=True)
class PropSimResult:
    passed: bool
    outcome: str  # passed | daily_breach | max_loss_breach | timeout
    days: int
    trading_days: int
    final_equity: float
    max_drawdown_pct: float
    worst_daily_pct: float
    hit_profit_target_day: int | None


def simulate_challenge(
    daily_returns: np.ndarray,
    rules: PropRules | None = None,
) -> PropSimResult:
    """Step through daily returns; reset daily loss reference each day (simplified)."""
    r = PropRules() if rules is None else rules
    rets = np.asarray(daily_returns, dtype=float)
    rets = rets[np.isfinite(rets)]
    if rets.size == 0:
        return PropSimResult(
            passed=False,
            outcome="timeout",
            days=0,
            trading_days=0,
            final_equity=r.initial_balance,
            max_drawdown_pct=0.0,
            worst_daily_pct=0.0,
            hit_profit_target_day=None,
        )

    equity = r.initial_balance
    floor = r.initial_balance * (1.0 - r.max_total_loss_pct)
    target = r.initial_balance * (1.0 + r.profit_target_pct)
    daily_cap = r.initial_balance * r.max_daily_loss_pct

    peak = equity
    max_dd = 0.0
    worst_day = 0.0
    trading_days = 0
    hit_target: int | None = None

    for i, ret in enumerate(rets):
        day_start = equity
        pnl = day_start * ret
        if abs(ret) > r.traded_day_abs_return:
            trading_days += 1
        # Intraday breach: loss exceeds daily cap (conservative single-close model)
        if pnl <= -daily_cap:
            return PropSimResult(
                passed=False,
                outcome="daily_breach",
                days=i + 1,
                trading_days=trading_days,
                final_equity=day_start + pnl,
                max_drawdown_pct=max_dd,
                worst_daily_pct=min(worst_day, ret),
                hit_profit_target_day=hit_target,
            )
        equity = day_start + pnl
        worst_day = min(worst_day, ret)
        peak = max(peak, equity)
        dd = equity / peak - 1.0
        max_dd = min(max_dd, dd)
        if equity <= floor:
            return PropSimResult(
                passed=False,
                outcome="max_loss_breach",
                days=i + 1,
                trading_days=trading_days,
                final_equity=equity,
                max_drawdown_pct=max_dd,
                worst_daily_pct=worst_day,
                hit_profit_target_day=hit_target,
            )
        if hit_target is None and equity >= target:
            hit_target = i + 1
        if hit_target is not None and trading_days >= r.min_trading_days and equity >= target:
            return PropSimResult(
                passed=True,
                outcome="passed",
                days=i + 1,
                trading_days=trading_days,
                final_equity=equity,
                max_drawdown_pct=max_dd,
                worst_daily_pct=worst_day,
                hit_profit_target_day=hit_target,
            )

    return PropSimResult(
        passed=False,
        outcome="timeout",
        days=len(rets),
        trading_days=trading_days,
        final_equity=equity,
        max_drawdown_pct=max_dd,
        worst_daily_pct=worst_day,
        hit_profit_target_day=hit_target,
    )


def load_returns_csv(path: str) -> np.ndarray:
    import pandas as pd

    df = pd.read_csv(path)
    col = "return" if "return" in df.columns else df.columns[-1]
    return df[col].to_numpy(dtype=float)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--returns-csv", required=True, help="CSV with daily return column")
    p.add_argument("--initial", type=float, default=100_000.0)
    p.add_argument("--daily-loss", type=float, default=0.05)
    p.add_argument("--max-loss", type=float, default=0.10)
    p.add_argument("--target", type=float, default=0.10)
    args = p.parse_args(argv)
    rules = PropRules(
        initial_balance=args.initial,
        max_daily_loss_pct=args.daily_loss,
        max_total_loss_pct=args.max_loss,
        profit_target_pct=args.target,
    )
    rets = load_returns_csv(args.returns_csv)
    out = simulate_challenge(rets, rules)
    print(json.dumps(asdict(out), indent=2))
    return 0 if out.passed else 1


if __name__ == "__main__":
    sys.exit(main())
