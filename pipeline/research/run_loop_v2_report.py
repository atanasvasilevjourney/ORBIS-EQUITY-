"""Generate LOOP v2 REPORT.md + charts (six pre-declared runs).

Usage:
    python -m pipeline.research.run_loop_v2_report
    python -m pipeline.research.run_loop_v2_report --quick
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

from pipeline.research.loop_v2_harness import run_all

OUT = Path(__file__).resolve().parent / "LOOP_V2"
DEFAULT_END = date(2026, 11, 21)


def _equity_curve(daily: pd.Series) -> pd.Series:
    return (1 + daily.fillna(0)).cumprod()


def plot_equity(summary: dict, out: Path) -> Path:
    """Bar chart: total return 2010+ @ 25 bps (from harness summary, no re-run)."""
    full_rows = [
        r
        for r in summary["results"]
        if r.get("period") == "full" and r.get("cost") in ("25bps", "0bps")
    ]
    labels = []
    rets = []
    for r in sorted(full_rows, key=lambda x: x.get("run_id", "9")):
        labels.append(r.get("variant", "?"))
        rets.append(100 * float(r.get("total_return", 0)))

    fig, ax = plt.subplots(figsize=(10, 5))
    colors = ["#2ecc71" if v == "loop_v2_full" else "#3498db" for v in labels]
    ax.bar(labels, rets, color=colors)
    ax.axhline(0, color="black", linewidth=0.5)
    ax.set_title("Total return 2010+ @ 25 bps/side (SPY @ 0 bps)")
    ax.set_ylabel("Total return %")
    ax.tick_params(axis="x", rotation=25)
    ax.grid(axis="y", alpha=0.3)
    path = out / "equity_curves.png"
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)

    # Second chart: Sharpe full vs OOS for loop v2 full
    fig2, ax2 = plt.subplots(figsize=(6, 4))
    sharpe_rows = [r for r in summary["results"] if r.get("variant") == "loop_v2_full" and r["cost"] == "25bps"]
    ax2.bar([r["period"] for r in sharpe_rows], [r["sharpe"] for r in sharpe_rows], color="#2ecc71")
    ax2.set_title("LOOP v2 full — Sharpe @ 25 bps")
    ax2.set_ylabel("Sharpe")
    ax2.grid(axis="y", alpha=0.3)
    path2 = out / "sharpe_by_window.png"
    fig2.tight_layout()
    fig2.savefig(path2, dpi=120)
    plt.close(fig2)
    return path


def _fmt_pct(x: float) -> str:
    return f"{100 * x:+.1f}%"


def render_report(summary: dict) -> str:
    verdict = summary.get("pass_overall", False)
    vf = summary.get("pass_fail_25bps_loop_v2_full", {})
    lines = [
        "# LOOP v2 backtest report",
        "",
        f"**Evaluation end:** {summary['end']} · **Deflated Sharpe trials:** {summary['n_trials_deflated_sharpe']}",
        "",
        "## Pass / fail (LOOP v2 full vs SPY @ 25 bps)",
        "",
        f"- **2010+:** {'PASS' if vf.get('full') else 'FAIL'}",
        f"- **2019+ (OOS):** {'PASS' if vf.get('oos') else 'FAIL'}",
        f"- **Overall:** {'PASS' if verdict else 'FAIL'}",
        "",
        "_Criterion: v2 Sharpe > SPY Sharpe and |max DD| smaller than SPY in both windows at 25 bps/side._",
        "",
        "## Results table (25 bps)",
        "",
        "| Run | Period | CAGR | Total | Vol | Sharpe | D.Sharpe | MaxDD | Turnover | Avg names | % invested | VWAP fill % |",
        "|-----|--------|------|-------|-----|--------|----------|-------|----------|-----------|------------|-------------|",
    ]
    for row in sorted(summary["results"], key=lambda r: (r.get("period", ""), r.get("run_id", "9"))):
        if row.get("cost") != "25bps" and row.get("variant") != "SPY":
            continue
        ds = row.get("deflated_sharpe", 0)
        lines.append(
            f"| {row.get('variant', row.get('name'))} | {row.get('period')} | "
            f"{_fmt_pct(row.get('cagr', 0))} | {_fmt_pct(row.get('total_return', 0))} | "
            f"{_fmt_pct(row.get('annualized_vol', 0))} | {row.get('sharpe', 0):.2f} | {ds:.2f} | "
            f"{_fmt_pct(row.get('max_drawdown', 0))} | {row.get('turnover', 0):.1f} | "
            f"{row.get('avg_holdings', 0):.1f} | {row.get('pct_time_invested', 0):.0f}% | "
            f"{row.get('vwap_limit_fill_rate', 0):.0f}% |"
        )
    lines.extend(["", "## Results table (10 bps)", ""])
    lines.append("| Run | Period | CAGR | Total | Sharpe | MaxDD |")
    lines.append("|-----|--------|------|-------|--------|-------|")
    for row in summary["results"]:
        if row.get("cost") != "10bps":
            continue
        lines.append(
            f"| {row.get('variant')} | {row.get('period')} | {_fmt_pct(row.get('cagr', 0))} | "
            f"{_fmt_pct(row.get('total_return', 0))} | {row.get('sharpe', 0):.2f} | "
            f"{_fmt_pct(row.get('max_drawdown', 0))} |"
        )
    lines.extend(
        [
            "",
            "## Charts",
            "",
            "![Total return by run](equity_curves.png)",
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
    parser.add_argument("--quick", action="store_true", help="Only v2 full variant (faster)")
    parser.add_argument(
        "--skip-baseline",
        action="store_true",
        help="Omit baseline LOOP run (faster; CI smoke)",
    )
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    end = date.fromisoformat(args.end)
    args.out.mkdir(parents=True, exist_ok=True)

    print("Running LOOP v2 harness…", flush=True)
    summary = run_all(end=end, quick=args.quick, skip_baseline=args.skip_baseline)
    (args.out / "loop_v2_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    if not args.quick:
        print("Plotting equity curves…", flush=True)
        plot_equity(summary, args.out)

    report = render_report(summary)
    (args.out / "REPORT.md").write_text(report, encoding="utf-8")
    print(f"Wrote {args.out / 'REPORT.md'}", flush=True)


if __name__ == "__main__":
    main()