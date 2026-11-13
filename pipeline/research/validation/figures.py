"""Matplotlib sheets for a module validation run."""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from pipeline.research.validation.metrics import ModuleRun


def draw_module(run: ModuleRun, path: Path | None = None):
    """Three-panel sheet: equity, drawdown, trade returns. Returns the figure."""
    eq = run.equity.astype(float)
    bench = run.benchmark.reindex(eq.index).astype(float)
    bench = bench / bench.iloc[0] if len(bench) and bench.iloc[0] else bench
    eq_n = eq / eq.iloc[0] if len(eq) and eq.iloc[0] else eq
    peak = eq_n.cummax()
    dd = (eq_n / peak.replace(0, np.nan) - 1.0) * 100.0

    fig, axes = plt.subplots(3, 1, figsize=(10, 8.2), constrained_layout=True)
    fig.suptitle(run.title, fontsize=13)

    axes[0].plot(eq.index, eq_n, color="#1f4e79", lw=1.6, label="Strategy")
    axes[0].plot(bench.index, bench, color="#9aa0a6", lw=1.1, label="Equal-weight tape")
    axes[0].set_ylabel("Growth of 1")
    axes[0].legend(frameon=False, fontsize=8)
    axes[0].set_title(
        f"Sharpe {run.metrics['sharpe']}  ·  total {run.metrics['total_return_pct']}%  "
        f"·  max DD {run.metrics['max_drawdown_pct']}%"
    )

    axes[1].fill_between(dd.index, dd.to_numpy(), 0, color="#b4534a", alpha=0.35)
    axes[1].plot(dd.index, dd, color="#b4534a", lw=0.8)
    axes[1].set_ylabel("Drawdown %")

    trades = np.asarray(run.trade_returns_pct, dtype=float)
    if trades.size:
        axes[2].hist(trades, bins=min(24, max(6, trades.size // 2)), color="#1f4e79", alpha=0.85)
        axes[2].axvline(0, color="#333", lw=0.8)
    else:
        axes[2].text(0.5, 0.5, "No trades on this tape", ha="center", va="center", transform=axes[2].transAxes)
    axes[2].set_xlabel("Trade return %  (after 10 bps each side)")
    axes[2].set_ylabel("Count")
    fig.text(0.01, 0.005, run.note, fontsize=7, color="#555")

    if path is not None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(path, dpi=120)
    return fig


def metrics_frame(run: ModuleRun) -> pd.DataFrame:
    return pd.DataFrame([run.metrics])
