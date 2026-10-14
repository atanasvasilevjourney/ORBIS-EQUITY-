"""Run Donchian+VWAP portfolio ATR trail parameter grid (IS/OOS)."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from pipeline.research.donchian_vwap_backtest import (
    _metrics,
    benchmark_returns,
    grid_search_atr_trail,
    is_oos_split,
    run_donchian_vwap_portfolio,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Donchian+VWAP ATR trail grid search")
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("pipeline/research/artifacts/donchian_atr_trail_grid.csv"),
    )
    parser.add_argument(
        "--mode",
        choices=("atr_trail", "tighter"),
        default="atr_trail",
        help="Exit rule to sweep (atr_trail = chandelier only)",
    )
    args = parser.parse_args()

    (is_start, is_end), (oos_start, oos_end) = is_oos_split()
    full_start, full_end = is_start, oos_end

    print("=== Baseline: Donchian 20 exit ===")
    base_ret, _ = run_donchian_vwap_portfolio(full_start, full_end, exit_mode="donchian20")
    spy = benchmark_returns(full_start, full_end, "SPY")
    for label, s, e, r in [
        ("IS baseline", is_start, is_end, base_ret),
        ("OOS baseline", oos_start, oos_end, base_ret),
        ("SPY OOS", oos_start, oos_end, spy),
    ]:
        m = _metrics(label, s, e, r)
        print(f"  {label}: return {m.total_return_pct:+.2f}%  Sharpe {m.sharpe:.2f}  maxDD {m.max_drawdown_pct:.2f}%")

    print(f"\n=== Grid: {args.mode} (ATR period × multiplier) ===")
    df = grid_search_atr_trail(exit_mode=args.mode)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)
    print(f"Wrote {args.out} ({len(df)} rows)\n")

    top = df.head(8)
    print(top.to_string(index=False, float_format=lambda x: f"{x:.3f}"))

    best = df.iloc[0]
    summary = {
        "exit_mode": args.mode,
        "best_atr_period": int(best["atr_period"]),
        "best_atr_mult": float(best["atr_mult"]),
        "is_return_pct": float(best["is_return_pct"]),
        "oos_return_pct": float(best["oos_return_pct"]),
        "is_sharpe": float(best["is_sharpe"]),
        "oos_sharpe": float(best["oos_sharpe"]),
        "is_max_dd_pct": float(best["is_max_dd_pct"]),
        "oos_max_dd_pct": float(best["oos_max_dd_pct"]),
    }
    json_path = args.out.with_suffix(".json")
    json_path.write_text(json.dumps(summary, indent=2))
    print(f"\nBest (OOS Sharpe): ATR({summary['best_atr_period']}) × {summary['best_atr_mult']}")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
