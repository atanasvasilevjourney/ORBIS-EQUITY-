"""Add PIT survivorship to existing summary and regenerate REPORT + walk_forward.png."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

from pipeline.research.donchian_vwap_backtest import build_research_panels
from pipeline.research.loop_donchian_harness import survivorship_comparison
from pipeline.research.run_loop_donchian_report import _plot_walk_forward
from pipeline.research.sp500_pit import build_sp500_sym_sector, membership_lookup, union_symbols_between

OUT = Path("pipeline/research/LOOP_DONCHIAN_CORRECTED")


def main() -> None:
    summary = json.loads((OUT / "loop_donchian_harness_summary.json").read_text(encoding="utf-8"))
    end = date.fromisoformat(summary["window"]["end"])
    pit_start = date(2010, 1, 4)
    print("Live panels…", flush=True)
    live_panels, live_signals, live_sym = build_research_panels("2009-06-01")
    print("PIT panels…", flush=True)
    pit_lookup = membership_lookup()
    union = union_symbols_between(pit_start, end)
    pit_sym = build_sp500_sym_sector(union)
    print(f"PIT symbols {len(pit_sym)}", flush=True)
    pit_panels, pit_signals, pit_sym = build_research_panels(
        "2009-06-01", sym_sector=pit_sym, symbols=list(pit_sym.keys()),
    )
    summary["survivorship_live_vs_pit"] = survivorship_comparison(
        pit_start, end,
        live_panels=live_panels, live_signals=live_signals, live_sym_sector=live_sym,
        pit_panels=pit_panels, pit_signals=pit_signals, pit_sym_sector=pit_sym,
        pit_lookup=pit_lookup,
    )
    summary["pit_data_source"] = "fja05680/sp500 GitHub (daily 1996+)"
    (OUT / "loop_donchian_harness_summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8",
    )
    wf = summary["walk_forward_frozen"]
    rolling = summary.get("walk_forward_rolling_3y1y") or []
    _plot_walk_forward(OUT, wf, rolling, end, live_panels, live_signals, live_sym)
    from pipeline.research.run_loop_donchian_report import write_report_md

    write_report_md(summary, date(2023, 1, 3), end, pit_start, OUT)
    print("Wrote REPORT.md + walk_forward.png", flush=True)


if __name__ == "__main__":
    main()