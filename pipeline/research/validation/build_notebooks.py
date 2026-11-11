"""Write one validation notebook per trading module."""
from __future__ import annotations

import json
from pathlib import Path

from pipeline.research.validation.modules import RUNNERS

OUT = Path(__file__).resolve().parents[1] / "notebooks" / "validation"

TITLES = {
    "watchlist": "01_watchlist_momentum",
    "donchian": "02_donchian_vwap",
    "xs": "03_xs_relative_strength",
    "opening_range": "04_opening_range",
    "tema": "05_tema",
    "carver": "06_carver",
    "rotation": "07_beta_rotation",
    "triangle": "08_triangle_breakout",
    "ema200": "09_ema200_touch",
    "kama": "10_kama_regime",
    "daily_bias": "11_daily_bias",
}


def _nb(name: str) -> dict:
    stem = TITLES[name]
    setup = """import sys
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd

ROOT = Path.cwd().resolve()
while ROOT.name and not (ROOT / "pipeline").exists():
    ROOT = ROOT.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.research.validation.figures import draw_module, metrics_frame
from pipeline.research.validation.modules import run_module
from pipeline.research.validation.panel import synthetic_panel

pd.set_option("display.width", 120)
pd.set_option("display.max_columns", 20)
"""
    run = f"""panel = synthetic_panel()
result = run_module({name!r}, panel)
print(result.title)
for rule in result.rules:
    print("-", rule)
print()
print(result.note)
metrics_frame(result)
"""
    plot = f"""from IPython.display import Image, display

fig_dir = ROOT / "pipeline" / "research" / "notebooks" / "validation" / "figures"
fig_path = fig_dir / "{stem}.png"
fig = draw_module(result, fig_path)
plt.close(fig)
display(Image(filename=str(fig_path)))
"""
    return {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "pygments_lexer": "ipython3"},
        },
        "cells": [
            {
                "cell_type": "markdown",
                "metadata": {},
                "source": [
                    f"# {stem.replace('_', ' ')}\n",
                    "\n",
                    "Validation backtest for this trading module. The tape is synthetic and seeded, ",
                    "so the chart checks that the production rules fire and how the book ",
                    "compounds after 10 bps a side. It is not a live-edge claim.\n",
                ],
            },
            {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": setup.splitlines(keepends=True)},
            {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": run.splitlines(keepends=True)},
            {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": plot.splitlines(keepends=True)},
        ],
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name in RUNNERS:
        path = OUT / f"{TITLES[name]}.ipynb"
        path.write_text(json.dumps(_nb(name), indent=1) + "\n")
        print(path)


if __name__ == "__main__":
    main()
