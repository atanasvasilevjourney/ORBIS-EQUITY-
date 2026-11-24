"""Generate Turtle System 1 REPORT.md + charts.

Usage:
    python -m pipeline.research.run_turtle_s1_report
    python -m pipeline.research.run_turtle_s1_report --quick
"""
from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from pipeline.research.turtle_s1_harness import run_all

OUT = Path(__file__).resolve().parent / "TURTLE_S1"
DEFAULT_END = date(2026, 11, 21)
PR_URL_PLACEHOLDER = "https://github.com/atanasvasilevjourney/ORBIS-EQUITY-/pull/TBD"


def _equity_curve(daily: pd.Series) -> pd.Series:
    return (1 + daily.fillna(0)).cumprod()


def plot_charts(summary: dict, daily_by_key: dict[str, pd.Series], out: Path) -> None:
    """Equity curves (25 bps, 2010+) and Sharpe-by-window for T1–T4."""
    variants = ["turtle_s1_t1", "turtle_s1_t2", "turtle_s1_t3", "turtle_s1_t4", "loop_v2_full", "SPY"]
    fig, ax = plt.subplots(figsize=(11, 5))
    for var in variants:
        if var == "SPY":
            key = "SPY|0bps"
        else:
            key = f"{var}|25bps"
        daily = daily_by_key.get(key)
        if daily is None or daily.empty:
            continue
        eq = _equity_curve(daily)
        ax.plot(eq.index, eq.values, label=var, linewidth=1.2)
    ax.set_title("Equity curves @ 25 bps/side (SPY @ 0 bps)")
    ax.set_ylabel("Growth of $1")
    ax.legend(fontsize=8)
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(out / "equity_curves.png", dpi=120)
    plt.close(fig)

    fig2, ax2 = plt.subplots(figsize=(8, 4))
    labels = []
    full_sh = []
    oos_sh = []
    for var in ["turtle_s1_t1", "turtle_s1_t2", "turtle_s1_t3", "turtle_s1_t4"]:
        f = next(
            (r for r in summary["results"] if r["variant"] == var and r["period"] == "full" and r["cost"] == "25bps"),
            None,
        )
        o = next(
            (r for r in summary["results"] if r["variant"] == var and r["period"] == "oos" and r["cost"] == "25bps"),
            None,
        )
        if f and o:
            labels.append(var.replace("turtle_s1_", "").upper())
            full_sh.append(f["sharpe"])
            oos_sh.append(o["sharpe"])
    x = range(len(labels))
    w = 0.35
    ax2.bar([i - w / 2 for i in x], full_sh, w, label="2010+")
    ax2.bar([i + w / 2 for i in x], oos_sh, w, label="2019+")
    ax2.set_xticks(list(x))
    ax2.set_xticklabels(labels)
    ax2.set_ylabel("Sharpe")
    ax2.set_title("Turtle S1 variants — Sharpe @ 25 bps")
    ax2.legend()
    ax2.grid(axis="y", alpha=0.3)
    fig2.tight_layout()
    fig2.savefig(out / "sharpe_by_window.png", dpi=120)
    plt.close(fig2)


def _fmt_pct(x: float) -> str:
    return f"{100 * x:+.1f}%"


def _row_line(row: dict) -> str:
    return (
        f"| {row.get('run_id', '')} {row.get('variant', row.get('name'))} | {row.get('period')} | "
        f"{_fmt_pct(row.get('cagr', 0))} | {_fmt_pct(row.get('total_return', 0))} | "
        f"{_fmt_pct(row.get('annualized_vol', 0))} | {row.get('sharpe', 0):.2f} | "
        f"{row.get('deflated_sharpe', 0):.2f} | {_fmt_pct(row.get('max_drawdown', 0))} | "
        f"{row.get('turnover', 0):.1f} | {row.get('avg_holdings', 0):.1f} | "
        f"{row.get('pct_time_invested', 0):.0f}% | {row.get('trade_count', 0)} | "
        f"{row.get('win_rate', 0):.0f}% | {row.get('avg_holding_days', 0):.0f} | "
        f"{row.get('avg_r_multiple', 0):.2f} | {row.get('payoff_ratio', 0):.2f} |"
    )


def render_report(summary: dict, pr_url: str) -> str:
    header = (
        "| Run | Period | CAGR | Total | Vol | Sharpe | D.Sharpe | MaxDD | Turnover | "
        "Avg names | % inv | Trades | Win% | Avg days | Avg R | Payoff |"
    )
    sep = (
        "|-----|--------|------|-------|-----|--------|----------|-------|----------|"
        "-----------|-------|--------|------|----------|------|--------|"
    )
    pf = summary.get("pass_fail_25bps_by_variant", {})
    skip = summary.get("skip_rule_analysis", {})
    lines = [
        "# Turtle System 1 Donchian backtest",
        "",
        f"**PR:** {pr_url}",
        "",
        f"**Evaluation end:** {summary['end']} · **Deflated Sharpe trials:** {summary['n_trials_deflated_sharpe']}",
        "",
        "Pre-declared runs: **T1** baseline + skip rule, **T2** + 200d SMA, **T3** pyramiding, **T4** no skip,",
        "**loop_v2_full** reference, **SPY** benchmark.",
        "",
        "## Pass / fail vs SPY (@ 25 bps/side)",
        "",
        "_Criterion: Sharpe > SPY Sharpe and smaller |max DD| in both 2010+ and 2019+ windows._",
        "",
    ]
    for var in ["turtle_s1_t1", "turtle_s1_t2", "turtle_s1_t3", "turtle_s1_t4"]:
        v = pf.get(var, {})
        overall = v.get("full") and v.get("oos")
        lines.append(
            f"- **{var}:** 2010+ {'PASS' if v.get('full') else 'FAIL'} · "
            f"2019+ {'PASS' if v.get('oos') else 'FAIL'} · "
            f"**Overall {'PASS' if overall else 'FAIL'}**"
        )
    lines.extend(["", "## Skip rule (T1 vs T4)", ""])
    if skip:
        lines.append(
            f"- Skip signals fired: **{skip.get('skip_signals_fired', 0)}** "
            f"(each followed a winning prior System 1 cycle on that symbol)."
        )
        helped = skip.get("skip_helped_sharpe")
        lines.append(
            f"- T1 Sharpe (2010+ @ 25 bps): {skip.get('t1_sharpe_full_25bps', 0):.2f}; "
            f"T4: {skip.get('t4_sharpe_full_25bps', 0):.2f} → skip rule "
            f"{'helped' if helped else 'did not help' if helped is False else 'n/a'}."
        )
    lines.extend(["", "## Results table (25 bps)", "", header, sep])
    for row in sorted(
        [r for r in summary["results"] if r.get("cost") == "25bps" or r.get("variant") == "SPY"],
        key=lambda r: (r.get("period", ""), str(r.get("run_id", "Z"))),
    ):
        lines.append(_row_line(row))
    lines.extend(["", "## Results table (10 bps)", "", header, sep])
    for row in sorted(
        [r for r in summary["results"] if r.get("cost") == "10bps"],
        key=lambda r: (r.get("period", ""), str(r.get("run_id", "Z"))),
    ):
        lines.append(_row_line(row))
    lines.extend(
        [
            "",
            "## Charts",
            "",
            "![Equity curves](equity_curves.png)",
            "",
            "![Sharpe by window](sharpe_by_window.png)",
            "",
            "## Data caveats",
            "",
        ]
    )
    for c in summary.get("data_caveats", []):
        lines.append(f"- {c}")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--end", default=DEFAULT_END.isoformat())
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--skip-loop-v2", action="store_true")
    parser.add_argument("--pr-url", default=PR_URL_PLACEHOLDER)
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    end = date.fromisoformat(args.end)
    args.out.mkdir(parents=True, exist_ok=True)

    print("Running Turtle S1 harness…", flush=True)
    summary = run_all(end=end, quick=args.quick, skip_loop_v2=args.skip_loop_v2)
    daily_by_run = summary.pop("_daily_by_run", {})
    json_path = args.out / "turtle_s1_summary.json"
    json_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    if not args.quick and daily_by_run:
        print("Plotting charts…", flush=True)
        plot_charts(summary, daily_by_run, args.out)

    report = render_report(summary, args.pr_url)
    (args.out / "REPORT.md").write_text(report, encoding="utf-8")
    print(f"Wrote {args.out / 'REPORT.md'}", flush=True)


if __name__ == "__main__":
    main()