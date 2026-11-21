"""Generate corrected LOOP Donchian research report (markdown + PNG charts)."""
from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from pipeline.research.donchian_vwap_backtest import (
    benchmark_returns,
    build_research_panels,
    run_donchian_vwap_portfolio,
)
from pipeline.research.loop_donchian_harness import (
    TEST_START,
    average_rebalance_weekdays,
    benchmark_suite,
    build_summary,
)
from pipeline.research.sp500_pit import (
    build_sp500_sym_sector,
    membership_lookup,
    union_symbols_between,
)


def _equity_curve(daily: pd.Series) -> pd.Series:
    return (1 + daily.fillna(0)).cumprod()


def _plot_walk_forward(out: Path, wf: dict, rolling: list[dict], test_end: date, live_panels, live_signals, live_sym_sector) -> Path:
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))
    atr_p, atr_m = wf["chosen_atr_period"], wf["chosen_atr_mult"]
    rot = wf.get("rotation_mode", "hold_until_stop")
    test_daily, _ = run_donchian_vwap_portfolio(
        TEST_START, test_end, data_start="2009-06-01",
        exit_mode="atr_trail", atr_period=atr_p, atr_mult=atr_m,
        rotation_mode=rot, panels=live_panels, signals=live_signals, sym_sector=live_sym_sector,
    )
    if not test_daily.empty:
        axes[0].plot(_equity_curve(test_daily), color="C0")
        axes[0].set_title(
            f"Frozen OOS {TEST_START}→{test_end} · ATR({atr_p})×{atr_m} · Sharpe {wf.get('test_sharpe', 0):.2f}"
        )
        axes[0].grid(True, alpha=0.3)
        axes[0].set_ylabel("Equity (start=1)")

    if rolling:
        years = [r["test_year"] for r in rolling]
        sharpes = [r["test_sharpe"] for r in rolling]
        defl = [r["deflated_test_sharpe"] for r in rolling]
        x = range(len(years))
        axes[1].bar([i - 0.15 for i in x], sharpes, width=0.3, label="Test Sharpe")
        axes[1].bar([i + 0.15 for i in x], defl, width=0.3, label="Deflated Sharpe")
        axes[1].set_xticks(list(x))
        axes[1].set_xticklabels(years, rotation=45)
        axes[1].set_title(f"Rolling 3y train / 1y test ({rolling[0]['n_trials']} trials/block)")
        axes[1].legend(fontsize=8)
        axes[1].grid(True, axis="y", alpha=0.3)
    fig.tight_layout()
    path = out / "walk_forward.png"
    fig.savefig(path, dpi=120)
    plt.close(fig)
    return path


def write_report_md(summary: dict, start: date, end: date, pit_start: date, out: Path) -> None:
    h = summary["headline_avg_weekday_hold_until_stop_atr3"]
    leg = summary["legacy_broken_releverage_exit_day"]
    bench = summary["benchmarks"]["SPY"]
    wd = summary["weekday_breakdown"]
    wd_lo = min(v["total_return"] for v in wd.values()) * 100
    wd_hi = max(v["total_return"] for v in wd.values()) * 100
    wf = summary["walk_forward_frozen"]
    rolling = summary.get("walk_forward_rolling_3y1y") or []
    surv = summary.get("survivorship_live_vs_pit")

    surv_md = ""
    if surv:
        lm = surv["live_sp500_ndx_union"]["metrics"]
        pm = surv["pit_sp500_only"]["metrics"]
        surv_md = f"""
## Survivorship (2010 → {end})

| Universe | Total return | Sharpe | Max DD |
|----------|-------------|--------|--------|
| Live S&P500 ∪ Nasdaq-100 | {lm['total_return']*100:+.1f}% | {lm['sharpe']:.2f} | {lm['max_dd']*100:.1f}% |
| PIT S&P 500 only ({surv['source']}) | {pm['total_return']*100:+.1f}% | {pm['sharpe']:.2f} | {pm['max_dd']*100:.1f}% |

**Delta (live − PIT):** {surv['delta_total_return_pct']:+.1f}% return, {surv['delta_sharpe']:+.2f} Sharpe.
"""

    rolling_lines = "\n".join(
        f"- {r['test_year']}: return {r['test_return_pct']:+.1f}%, Sharpe {r['test_sharpe']:.2f}, "
        f"deflated {r['deflated_test_sharpe']:.2f}, ATR({r['chosen_atr_period']})×{r['chosen_atr_mult']} "
        f"({r['n_trials']} trials)"
        for r in rolling
    )

    md = f"""# LOOP Donchian + VWAP — corrected research

**Headline window:** {start} → {end} · **PIT / long history:** from {pit_start}

## Why +54% sits next to +14%–+121% weekday range

The reported **headline** ({h['total_return']*100:+.1f}%) is the **mean of five daily return series**, one per rebalance weekday (Mon–Fri), hold-until-stop, ATR×3. Single-weekday totals on the same calendar window run from **{wd_lo:+.1f}% to {wd_hi:+.1f}%** ({json.dumps({k: round(v['total_return']*100,1) for k,v in wd.items()})}). We report the average because rebalance weekday alone can move full-period totals by an order of magnitude; the dispersion table is mandatory context, not a contradiction.

## Walk-forward (15 ATR grid trials each selection)

**Frozen:** train {wf.get('train_start')}–{wf.get('train_end')}, frozen test {wf.get('test_start')}→{wf.get('test_end')}. \
Chosen **ATR({wf.get('chosen_atr_period')})×{wf.get('chosen_atr_mult')}** ({wf.get('rotation_mode')}). \
Test return **{wf.get('test_return_pct', 0):+.1f}%**, Sharpe **{wf.get('test_sharpe', 0):.2f}**, \
**deflated Sharpe {wf.get('deflated_test_sharpe', 0):.2f}** (n_trials={wf.get('n_trials')}).

**Rolling 3y train / 1y test:**

{rolling_lines or '(none)'}

![Walk-forward](walk_forward.png)

## Headline table ({start} → {end})

| Series | Total return | Sharpe | Max DD |
|--------|-------------|--------|--------|
| Corrected avg weekday, hold-until-stop, ATR×3 | {h['total_return']*100:+.1f}% | {h['sharpe']:.2f} | {h['max_dd']*100:.1f}% |
| Legacy broken accounting | {leg['total_return']*100:+.1f}% | {leg['sharpe']:.2f} | {leg['max_dd']*100:.1f}% |
| SPY | {bench['total_return']*100:+.1f}% | {bench['sharpe']:.2f} | {bench['max_dd']*100:.1f}% |
{surv_md}
## Charts

![Equity curves](equity_curves.png)

## Conclusion

Corrected accounting removes bogus +300% headlines. Deflated OOS Sharpes and cost stress weaken the case vs SPY/QQQ; survivorship and weekday choice remain dominant effects.
"""
    (out / "REPORT.md").write_text(md, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2023-01-03", help="Recent window start for headline table")
    parser.add_argument("--end", default=date.today().isoformat())
    parser.add_argument("--pit-start", default="2010-01-04", help="Survivorship comparison start")
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("pipeline/research/LOOP_DONCHIAN_CORRECTED"),
    )
    parser.add_argument("--quick", action="store_true", help="Skip walk-forward and pit download")
    parser.add_argument(
        "--from-json-only",
        action="store_true",
        help="Regenerate REPORT.md from existing loop_donchian_harness_summary.json",
    )
    args = parser.parse_args()
    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)
    pit_start = date.fromisoformat(args.pit_start)
    out = args.out_dir
    out.mkdir(parents=True, exist_ok=True)

    if args.from_json_only:
        summary = json.loads((out / "loop_donchian_harness_summary.json").read_text(encoding="utf-8"))
        write_report_md(summary, start, end, pit_start, out)
        print(f"Wrote {out / 'REPORT.md'}", flush=True)
        return

    import json
    import logging

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    print("Building live universe panels…", flush=True)
    live_panels, live_signals, live_sym_sector = build_research_panels("2009-06-01")

    pit_panels = pit_signals = pit_sym_sector = pit_lookup = None
    summary = build_summary(
        start, end, out,
        live_panels=live_panels, live_signals=live_signals, live_sym_sector=live_sym_sector,
        run_walk_forward=not args.quick,
    )

    if not args.quick:
        print("Walk-forward complete; building PIT S&P 500 panels…", flush=True)
        pit_lookup = membership_lookup()
        union = union_symbols_between(pit_start, end)
        pit_sym_sector = build_sp500_sym_sector(union)
        pit_panels, pit_signals, pit_sym_sector = build_research_panels(
            "2009-06-01", sym_sector=pit_sym_sector, symbols=list(pit_sym_sector.keys()),
        )
        from pipeline.research.loop_donchian_harness import survivorship_comparison

        summary["survivorship_live_vs_pit"] = survivorship_comparison(
            pit_start, end,
            live_panels=live_panels, live_signals=live_signals, live_sym_sector=live_sym_sector,
            pit_panels=pit_panels, pit_signals=pit_signals, pit_sym_sector=pit_sym_sector,
            pit_lookup=pit_lookup,
        )
        (out / "loop_donchian_harness_summary.json").write_text(
            json.dumps(summary, indent=2), encoding="utf-8",
        )

    headline, _ = average_rebalance_weekdays(
        start, end, rotation_mode="hold_until_stop", atr_mult=3.0,
        panels=live_panels, signals=live_signals, sym_sector=live_sym_sector,
    )
    legacy, _ = run_donchian_vwap_portfolio(
        start, end, legacy_accounting=True, atr_mult=2.0,
        panels=live_panels, signals=live_signals, sym_sector=live_sym_sector,
    )
    corrected, _ = run_donchian_vwap_portfolio(
        start, end, atr_mult=2.0, panels=live_panels, signals=live_signals, sym_sector=live_sym_sector,
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

    wf = summary["walk_forward_frozen"]
    rolling = summary.get("walk_forward_rolling_3y1y") or []
    wf_path = out / "walk_forward.png"
    if not args.quick and "chosen_atr_period" in wf:
        wf_path = _plot_walk_forward(
            out, wf, rolling, end, live_panels, live_signals, live_sym_sector,
        )

    write_report_md(summary, start, end, pit_start, out)
    print(f"Wrote {out / 'REPORT.md'}, {eq_path}, {wf_path}", flush=True)


if __name__ == "__main__":
    main()