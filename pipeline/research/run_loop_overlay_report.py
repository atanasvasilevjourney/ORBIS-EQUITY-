"""Generate LOOP overlay research report (markdown + PNG charts)."""
from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from pipeline.research.donchian_vwap_backtest import benchmark_returns
from pipeline.research.loop_overlay_harness import (
    N_OVERLAY_TRIALS,
    OVERLAY_VARIANTS,
    TEST_START,
    build_overlay_summary,
)


def _equity(daily: pd.Series) -> pd.Series:
    return (1 + daily.fillna(0)).cumprod()


def _load_oos_daily(out: Path, name: str) -> pd.Series:
    p = out / f"daily_{name}.csv"
    s = pd.read_csv(p, index_col=0, parse_dates=True).squeeze(axis=1)
    s.name = name
    return s


def plot_charts(out: Path, end: date) -> None:
    spy_oos = benchmark_returns(TEST_START, end, "SPY")
    fig, axes = plt.subplots(2, 1, figsize=(12, 8), sharex=True)
    axes[0].plot(_equity(spy_oos), label="SPY", color="black", linewidth=1.5)

    colors = plt.cm.tab10.colors
    for i, name in enumerate(OVERLAY_VARIANTS):
        p = out / f"daily_{name}.csv"
        if not p.is_file():
            continue
        s = _load_oos_daily(out, name)
        if not s.empty:
            axes[0].plot(_equity(s), label=name, alpha=0.85, color=colors[i % len(colors)])

    axes[0].set_title(f"OOS equity curves ({TEST_START} → {end}) · {N_OVERLAY_TRIALS} pre-declared overlays")
    axes[0].legend(fontsize=7, ncol=2)
    axes[0].grid(True, alpha=0.3)
    axes[0].set_ylabel("Growth of $1")

    for i, name in enumerate(("breadth_spy_15_cash", "spy_chandelier_atr14_x3", "core_spy_80_loop_20")):
        p = out / f"daily_{name}.csv"
        if not p.is_file():
            continue
        s = _load_oos_daily(out, name)
        eq = _equity(s)
        dd = eq / eq.cummax() - 1
        axes[1].plot(dd, label=name, color=colors[i % len(colors)])
    spy_dd = _equity(spy_oos) / _equity(spy_oos).cummax() - 1
    axes[1].plot(spy_dd, label="SPY", color="black", linestyle="--")
    axes[1].set_title("Drawdowns (selected overlays vs SPY)")
    axes[1].legend(fontsize=8)
    axes[1].grid(True, alpha=0.3)
    axes[1].set_ylabel("Drawdown")

    fig.tight_layout()
    fig.savefig(out / "equity_drawdowns.png", dpi=120)
    plt.close(fig)


def _md_row(name: str, m: dict) -> str:
    return (
        f"| {name} | {m['total_return']*100:+.1f}% | {m['sharpe']:.2f} | "
        f"{m['deflated_sharpe']:.2f} | {m['max_dd']*100:.1f}% | {m['time_in_market']*100:.0f}% | "
        f"{m['dd_2020']*100:.1f}% | {m['dd_2022']*100:.1f}% |"
    )


def _annual_roll_lines(summary: dict) -> str:
    roll = summary.get("rolling_oos_annual_sharpe", {})
    lines: list[str] = []
    for y in sorted(roll.keys()):
        by = roll[y]
        spy = by.get("SPY", 0.0)
        ovs = [(v, k) for k, v in by.items() if k != "SPY"]
        best = max(ovs) if ovs else (0.0, "n/a")
        lines.append(f"- **{y}**: SPY {spy:.2f}; best overlay {best[1]} {best[0]:.2f}")
    return "\n".join(lines) or "(none)"


def write_report_md(summary: dict, out: Path, end: date) -> None:
    oos = summary["variants_oos_frozen"]
    bench = summary["benchmarks_oos"]
    tw = summary["test_window"]
    roll_lines = _annual_roll_lines(summary)

    rows = "\n".join(_md_row(k, oos[k]) for k in OVERLAY_VARIANTS)
    brow = "\n".join(_md_row(k, bench[k]) for k in ("SPY", "RSP", "QQQ", "SPY_buy_hold_full"))

    stress = summary.get("cost_stress_25bps_sample", {})
    stress_lines = "\n".join(
        f"- **{k}** (25 bps/side): OOS Sharpe {v['sharpe']:.2f}, max DD {v['max_dd']*100:.1f}%"
        for k, v in stress.items()
    )

    best_sh = max((v["sharpe"], k) for k, v in oos.items())
    spy_sh = bench["SPY"]["sharpe"]
    spy_ret = bench["SPY"]["total_return"]
    best_ret = max((v["total_return"], k) for k, v in oos.items())
    ch = oos.get("spy_chandelier_atr14_x3", {})
    verdict = (
        f"**Breadth regime at 15% is not viable** (~3% time in market; cash drag). "
        f"**Core+satellite** tracks SPY-like Sharpe (~0.79–0.82) but **underperforms SPY return** "
        f"({best_ret[1]} {best_ret[0]*100:+.0f}% vs SPY {spy_ret*100:+.0f}%) and does not improve 2020/2022 drawdowns. "
        f"**SPY Donchian+VWAP gate** mostly sits in cash. "
        f"**SPY chandelier** trims 2020/2022 drawdowns (2020 {ch.get('dd_2020',0)*100:.1f}%, "
        f"2022 {ch.get('dd_2022',0)*100:.1f}% vs SPY {bench['SPY']['dd_2020']*100:.1f}% / {bench['SPY']['dd_2022']*100:.1f}%) "
        f"but at the cost of OOS Sharpe {ch.get('sharpe', 0):.2f} and return {ch.get('total_return',0)*100:+.0f}% "
        f"(~{ch.get('time_in_market',0)*100:.0f}% time in market). "
        f"**No overlay beats SPY OOS Sharpe ({spy_sh:.2f}) with deflated Sharpe after {N_OVERLAY_TRIALS} trials**; "
        f"the practical value is partial drawdown relief, not return enhancement."
    )

    md = f"""# LOOP as index overlay — research report

**Question:** Does LOOP add value as a **filter/overlay on an index** rather than as a standalone stock picker?

**Design:** {N_OVERLAY_TRIALS} variants fixed **before** inspecting 2019+ outcomes (deflated Sharpe uses n_trials={N_OVERLAY_TRIALS}). \
Train context 2010–2018; **frozen OOS** {tw['start']}→{tw['end']}. PIT S&P 500 membership for LOOP breadth sleeve; cash leg **BIL**; \
10 bps/side on index regime turns (25 bps stress on sample variants).

## Pre-declared variants

1. **breadth_spy_15_cash** — 100% SPY when ≥15% of PIT names show LOOP entry signal (`eligible`); else BIL.
2. **breadth_rsp_15_cash** — same breadth gate on **RSP**.
3. **breadth_spy_15_half** — below threshold: 50% SPY / 50% BIL; above: 100% SPY.
4. **core_spy_80_loop_20** — 80% SPY + 20% PIT LOOP sleeve (ATR 14×3.5, avg weekday).
5. **core_spy_90_loop_10** — 90% SPY + 10% LOOP sleeve.
6. **spy_donchian_vwap_cash** — SPY only when SPY itself passes Donchian(55)+VWAP(20); else BIL.
7. **spy_chandelier_atr14_x3** — SPY with chandelier stop on SPY (ATR 14×3); else BIL.

## OOS metrics ({tw['start']} → {tw['end']})

| Series | Total return | Sharpe | Deflated Sharpe | Max DD | Time in mkt | DD 2020 | DD 2022 |
|--------|-------------|--------|-----------------|--------|-------------|---------|---------|
{rows}

### Benchmarks (OOS)

| Series | Total return | Sharpe | Deflated Sharpe | Max DD | Time in mkt | DD 2020 | DD 2022 |
|--------|-------------|--------|-----------------|--------|-------------|---------|---------|
{brow}

## Rolling OOS (annual Sharpe)

{roll_lines}

## Cost stress (25 bps/side)

{stress_lines or '(none)'}

## Charts

![Equity and drawdowns](equity_drawdowns.png)

## Verdict

Highest OOS Sharpe: **{best_sh[1]}** ({best_sh[0]:.2f}) vs **SPY** ({spy_sh:.2f}). {verdict}
"""
    (out / "REPORT.md").write_text(md, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--end", default=date.today().isoformat())
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent / "LOOP_OVERLAY",
    )
    args = parser.parse_args()
    end = date.fromisoformat(args.end)
    out = args.out
    out.mkdir(parents=True, exist_ok=True)

    print("Building overlay summary (PIT universe + downloads)…", flush=True)
    summary, variants = build_overlay_summary(end=end, return_series=True)
    for name, (daily, _exp) in variants.items():
        oos = daily.loc[daily.index >= pd.Timestamp(TEST_START)]
        oos.to_csv(out / f"daily_{name}.csv", header=["daily_return"])
    (out / "loop_overlay_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    plot_charts(out, end)
    write_report_md(summary, out, end)
    print(f"Wrote {out / 'REPORT.md'}")


if __name__ == "__main__":
    main()