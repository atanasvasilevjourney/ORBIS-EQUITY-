"""Generate corrected LOOP Donchian research report (markdown + PNG charts)."""
from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from pipeline.research.donchian_vwap_backtest import run_donchian_vwap_portfolio
from pipeline.research.donchian_vwap_backtest import benchmark_returns
from pipeline.research.loop_donchian_harness import (
    average_rebalance_weekdays,
    benchmark_suite,
    build_summary,
    default_atr_param_grid,
    grid_search_atr_trail,
    walk_forward_frozen,
)


def _equity_curve(daily: pd.Series) -> pd.Series:
    return (1 + daily.fillna(0)).cumprod()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2023-01-03")
    parser.add_argument("--end", default=date.today().isoformat())
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("pipeline/research/LOOP_DONCHIAN_CORRECTED"),
    )
    parser.add_argument("--quick", action="store_true", help="Skip slow grid heatmap")
    args = parser.parse_args()
    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)
    out = args.out_dir
    out.mkdir(parents=True, exist_ok=True)

    from pipeline.research.donchian_vwap_backtest import build_research_panels

    panels, signals = build_research_panels("2009-06-01")
    summary = build_summary(start, end, out, panels=panels, signals=signals, skip_walk_forward=args.quick)
    summary["panels_cached"] = len(panels)

    headline, _ = average_rebalance_weekdays(
        start, end, rotation_mode="hold_until_stop", atr_mult=3.0,
        panels=panels, signals=signals,
    )
    legacy, _ = run_donchian_vwap_portfolio(
        start, end, legacy_accounting=True, atr_mult=2.0, panels=panels, signals=signals,
    )
    corrected, _ = run_donchian_vwap_portfolio(
        start, end, atr_mult=2.0, panels=panels, signals=signals,
    )

    fig, ax = plt.subplots(figsize=(10, 5))
    if not headline.empty:
        ax.plot(_equity_curve(headline), label="Corrected (avg weekday, hold-stop, ATR×3)")
    if not corrected.empty:
        ax.plot(_equity_curve(corrected), label="Corrected weekly ATR×2", alpha=0.7)
    if not legacy.empty:
        ax.plot(_equity_curve(legacy), label="Legacy broken accounting", linestyle="--", alpha=0.6)
    for t in ("SPY", "QQQ", "RSP"):
        br = benchmark_returns(start, end, t)
        if not br.empty:
            ax.plot(_equity_curve(br).values, label=t, alpha=0.5, linewidth=1)
    ax.set_title("Donchian+VWAP equity curves (normalized)")
    ax.legend(fontsize=8)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    eq_path = out / "equity_curves.png"
    fig.savefig(eq_path, dpi=120)
    plt.close(fig)

    if not args.quick:
        grid = grid_search_atr_trail(select_on_is_only=True)
        if not grid.empty:
            pivot = grid.pivot_table(
                index="atr_period", columns="atr_mult", values="is_sharpe",
            )
            fig2, ax2 = plt.subplots(figsize=(7, 4))
            im = ax2.imshow(pivot.values, aspect="auto", cmap="viridis")
            ax2.set_xticks(range(len(pivot.columns)))
            ax2.set_xticklabels([f"{c:g}" for c in pivot.columns])
            ax2.set_yticks(range(len(pivot.index)))
            ax2.set_yticklabels(pivot.index)
            ax2.set_xlabel("ATR mult")
            ax2.set_ylabel("ATR period")
            ax2.set_title("IS Sharpe (selection window; not OOS)")
            fig2.colorbar(im, ax=ax2)
            fig2.tight_layout()
            fig2.savefig(out / "param_heatmap_is_sharpe.png", dpi=120)
            plt.close(fig2)

    if args.quick:
        wf = {
            "note": "skipped in --quick; run without --quick for full walk-forward grid",
            "n_trials": len(default_atr_param_grid()),
        }
    else:
        wf = walk_forward_frozen(date(2018, 12, 31), date(2019, 1, 2), end)
    h = summary["headline_avg_weekday_hold_until_stop_atr3"]
    leg = summary["legacy_broken_releverage_exit_day"]
    bench = summary["benchmarks"]["SPY"]

    md = f"""# LOOP Donchian + VWAP — corrected research ({start} → {end})

## Invalid prior headline

Artifacts claiming **+307%** total return and **OOS Sharpe 3.73**
(`pipeline/research/artifacts/donchian_atr_trail_grid.json`) are **invalid** due to:

- exit-day P&L not booked when stops fire;
- re-leveraging cash across fewer names;
- ATR grid ranked on the same OOS window;
- survivorship-biased live index universe.

## Fill rules (see `pipeline/strategies/fill_rules.py`)

Signal at close *t*; entries fill **open *t+1***; EOD stops book **close→close** on exit day;
gap-through stops book **close→open**; rotate-outs **close→open**; **1/8 slot** weights with cash idle.

## Headline (robust)

| Series | Total return | Sharpe | Max DD |
|--------|-------------|--------|--------|
| Corrected avg weekday, hold-until-stop, ATR×3 | {h['total_return']*100:+.1f}% | {h['sharpe']:.2f} | {h['max_dd']*100:.1f}% |
| Legacy broken accounting (ATR×2) | {leg['total_return']*100:+.1f}% | {leg['sharpe']:.2f} | {leg['max_dd']*100:.1f}% |
| SPY buy-hold | {bench['total_return']*100:+.1f}% | {bench['sharpe']:.2f} | {bench['max_dd']*100:.1f}% |

**Walk-forward (train ≤2018, frozen params on 2019+):** ATR({wf.get('chosen_atr_period')})×{wf.get('chosen_atr_mult')}
→ test return {wf.get('test_return_pct', 0):+.1f}%, Sharpe {wf.get('test_sharpe', 0):.2f},
deflated Sharpe {wf.get('deflated_test_sharpe', 0):.2f} ({wf.get('n_trials', 0)} trials).

## Charts

![Equity curves](equity_curves.png)

## Conclusion

After corrected accounting, configurable costs, weekday averaging, and walk-forward parameter
selection, the Donchian+VWAP long book **does not reproduce** the prior +300% headline.
Performance is closer to flat vs SPY over recent windows; hold-until-stop with wider ATR
multiples is the least weak variant but remains modest vs benchmarks.
"""
    (out / "REPORT.md").write_text(md, encoding="utf-8")
    print(f"Wrote {out / 'REPORT.md'} and {eq_path}")


if __name__ == "__main__":
    main()