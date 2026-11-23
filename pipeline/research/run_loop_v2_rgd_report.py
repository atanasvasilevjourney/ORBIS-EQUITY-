"""Generate LOOP v2 RGD add-on report (RGD_ADDONS.md + chart).

Usage:
    python -m pipeline.research.run_loop_v2_rgd_report
    python -m pipeline.research.run_loop_v2_rgd_report --quick
"""
from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from pipeline.research.loop_v2_rgd_harness import RGD_VARIANTS, run_rgd_all

OUT = Path(__file__).resolve().parent / "LOOP_V2"
DEFAULT_END = date(2026, 11, 21)


def plot_rgd_sharpe(summary: dict, out: Path) -> Path:
    rows = [
        r
        for r in summary["results"]
        if r.get("cost") == "25bps" and r.get("period") == "full"
    ]
    by_var = {r["variant"]: r for r in rows if r["variant"] != "SPY"}
    spy = next((r for r in rows if r["variant"] == "SPY"), None)
    labels = [v.name for v in RGD_VARIANTS]
    sharpes = [float(by_var.get(name, {}).get("sharpe", 0)) for name in labels]
    fig, ax = plt.subplots(figsize=(10, 5))
    colors = ["#95a5a6" if n == "loop_v2_full" else "#9b59b6" for n in labels]
    ax.bar(labels, sharpes, color=colors)
    if spy:
        ax.axhline(float(spy["sharpe"]), color="#e74c3c", linestyle="--", label="SPY (full window)")
        ax.legend()
    ax.set_title("Sharpe @ 25 bps — 2010+ (LOOP v2 + RGD add-ons)")
    ax.set_ylabel("Sharpe")
    ax.tick_params(axis="x", rotation=28)
    ax.grid(axis="y", alpha=0.3)
    path = out / "rgd_addons_sharpe.png"
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)
    return path


def _fmt_pct(x: float) -> str:
    return f"{100 * x:+.1f}%"


def _row_line(row: dict) -> str:
    return (
        f"| {row.get('variant', row.get('name'))} | {row.get('period')} | "
        f"{_fmt_pct(row.get('cagr', 0))} | {_fmt_pct(row.get('total_return', 0))} | "
        f"{_fmt_pct(row.get('annualized_vol', 0))} | {row.get('sharpe', 0):.2f} | "
        f"{row.get('deflated_sharpe', 0):.2f} | {_fmt_pct(row.get('max_drawdown', 0))} | "
        f"{row.get('turnover', 0):.1f} | {row.get('avg_holdings', 0):.1f} | "
        f"{row.get('pct_time_invested', 0):.0f}% | {int(row.get('trade_count', 0))} | "
        f"{row.get('win_rate', 0):.0f}% | {row.get('avg_r_per_trade', 0):.2f}R |"
    )


def render_report(summary: dict, baseline_bug_note: str) -> str:
    header = (
        "| Variant | Period | CAGR | Total | Vol | Sharpe | D.Sharpe | MaxDD | Turnover | "
        "Avg names | % inv | Trades | Win% | Avg R |"
    )
    sep = (
        "|---------|--------|------|-------|-----|--------|----------|-------|----------|"
        "-----------|-------|--------|------|-------|"
    )
    def _sort_key(r: dict) -> tuple:
        period_order = 0 if r.get("period") == "full" else 1
        rid = r.get("run_id", "99")
        try:
            num = int(rid)
        except (TypeError, ValueError):
            num = 99
        return (period_order, num)

    rows_25 = sorted(
        [r for r in summary["results"] if r.get("cost") == "25bps" or r.get("variant") == "SPY"],
        key=_sort_key,
    )
    pf = summary.get("pass_fail_25bps_vs_spy", {})
    addon = summary.get("addon_sharpe_improved_vs_v2_full_25bps", {})
    lines = [
        "# LOOP v2 RGD add-ons report",
        "",
        f"**Evaluation end:** {summary['end']} · **Deflated Sharpe trials:** {summary['n_trials_deflated_sharpe']}",
        "",
        "Pre-declared experiment on `loop_v2_full` (VWAP entry + stop). Add-ons: "
        "**A** ER≥0.30, **B** vol-switched 55/34 Donchian, **C** half at 2R + breakeven, **D** A+B+C.",
        "",
        "## Pass / fail vs SPY @ 25 bps (Sharpe higher & |max DD| smaller, both windows)",
        "",
    ]
    for v in RGD_VARIANTS:
        verdict = pf.get(v.name, False)
        lines.append(f"- **{v.name}:** {'PASS' if verdict else 'FAIL'}")
    lines.extend(["", "## Per add-on — Sharpe vs LOOP v2 full @ 25 bps (both windows)", ""])
    for name, periods in addon.items():
        full_ok = periods.get("full", False)
        oos_ok = periods.get("oos", False)
        both = full_ok and oos_ok
        lines.append(
            f"- **{name}:** 2010+ {'↑' if full_ok else '↓'} · 2019+ {'↑' if oos_ok else '↓'} "
            f"→ **{'improved both' if both else 'did not improve both'}**"
        )
    lines.extend(
        [
            "",
            "## Results @ 25 bps",
            "",
            header,
            sep,
        ]
    )
    for row in rows_25:
        lines.append(_row_line(row))
    lines.extend(
        [
            "",
            "## Chart",
            "",
            "![Sharpe 2010+ @ 25 bps](rgd_addons_sharpe.png)",
            "",
            "## Baseline LOOP (PR 128) turnover note",
            "",
            baseline_bug_note,
            "",
        ]
    )
    for c in summary.get("data_caveats", []):
        lines.append(f"- {c}")
    lines.append("")
    return "\n".join(lines)


def baseline_loop_investigation_note() -> str:
    """Short note on baseline_loop −98.8% / turnover 0 in PR 128 (no trivial fix applied)."""
    return (
        "_PR 128 `baseline_loop` shows **−98.8%** total (2010+) with **turnover 0** in the table. "
        "Turnover is **0 because** `run_baseline_loop` does not populate `turnover_days` in stats—"
        "`summarize_run` divides a missing counter by trading days. "
        "The catastrophic return is **not** a missing-turnover display bug: `run_donchian_vwap_portfolio` "
        "weekly TOP_N=8 strategy with ATR trail, run on the **expanded PIT merged universe** with "
        "`rotation_mode='weekly'`, fully replaces the book each rebalance; on a broad, "
        "survivorship-aware universe this legacy configuration loses most capital (compare ~+456% "
        "for `loop_v2_full` on the same data). No code change applied—v2 full is the intended baseline "
        "for this experiment._"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--end", default=DEFAULT_END.isoformat())
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    end = date.fromisoformat(args.end)
    args.out.mkdir(parents=True, exist_ok=True)

    print("Running RGD harness…", flush=True)
    summary = run_rgd_all(end=end, quick=args.quick)
    (args.out / "rgd_addons_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    if not args.quick:
        plot_rgd_sharpe(summary, args.out)

    note = baseline_loop_investigation_note()
    report = render_report(summary, note)
    (args.out / "RGD_ADDONS.md").write_text(report, encoding="utf-8")
    print(f"Wrote {args.out / 'RGD_ADDONS.md'}", flush=True)


if __name__ == "__main__":
    main()