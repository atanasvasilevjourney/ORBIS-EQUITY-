"""Run Zarattini ORB validation on Orbis liquid universe; write charts + JSON summary."""

from __future__ import annotations

import json
import os
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd

from pipeline.research.zarattini_orb import (
    BacktestConfig,
    performance_summary,
    portfolio_equity_curve,
    run_opening_bias_backtest,
    trades_to_frame,
)
from pipeline.research.zarattini_orb_data import fetch_5m, orb_universe_symbols

ARTIFACT_DIR = Path(os.getenv("ZARATTINI_ORB_OUT", "/opt/cursor/artifacts/zarattini_orb"))
NOTEBOOK_OUT = Path(__file__).resolve().parents[2] / "notebooks" / "output"


def _calendar_from_bars(bars: pd.DataFrame) -> pd.DatetimeIndex:
    days = pd.to_datetime(bars["date"]).dt.normalize().unique()
    return pd.DatetimeIndex(sorted(days))


def run_validation(
    symbols: list[str] | None = None,
    period: str = "60d",
    capital_per_symbol: float = 25_000.0,
    max_symbols: int | None = None,
) -> dict:
    symbols = symbols or orb_universe_symbols()
    if max_symbols is not None and len(symbols) > max_symbols:
        # Always keep QQQ; take the rest from the liquid list alphabetically for reproducibility.
        core = [s for s in symbols if s != "QQQ"][: max_symbols - 1]
        symbols = sorted(set(core) | {"QQQ"})
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    NOTEBOOK_OUT.mkdir(parents=True, exist_ok=True)

    print("Fetching QQQ confirmation bars…")
    qqq_bars = fetch_5m("QQQ", period=period, pause_s=0)

    scenarios = {
        "no_slippage": BacktestConfig(
            initial_equity=capital_per_symbol,
            entry_slippage_per_share=0.0,
            additional_stop_slippage_per_share=0.0,
            require_confirmation=False,
        ),
        "slippage_2c": BacktestConfig(
            initial_equity=capital_per_symbol,
            entry_slippage_per_share=0.02,
            additional_stop_slippage_per_share=0.04,
            require_confirmation=False,
        ),
        "slippage_2c_qqq_confirm": BacktestConfig(
            initial_equity=capital_per_symbol,
            entry_slippage_per_share=0.02,
            additional_stop_slippage_per_share=0.04,
            require_confirmation=True,
        ),
    }

    summary: dict = {"period": period, "symbols": symbols, "scenarios": {}}

    for scen_name, cfg in scenarios.items():
        print(f"\n=== Scenario: {scen_name} ===")
        all_trades: list[pd.DataFrame] = []
        per_symbol: dict[str, dict] = {}
        calendar: pd.DatetimeIndex | None = None

        for sym in symbols:
            print(f"  {sym} …", flush=True)
            try:
                bars = fetch_5m(sym, period=period)
            except Exception as exc:
                print(f"    skip {sym}: {exc}")
                continue
            if bars.empty:
                continue
            if calendar is None:
                calendar = _calendar_from_bars(bars)
            confirm = qqq_bars if cfg.require_confirmation else None
            res = run_opening_bias_backtest(sym, bars, cfg, confirmation_bars=confirm)
            tdf = trades_to_frame(res.trades)
            if not tdf.empty:
                all_trades.append(tdf)
            per_symbol[sym] = performance_summary(
                tdf,
                cfg.initial_equity,
                res.final_equity,
            )
            per_symbol[sym]["bars"] = len(bars)

        if calendar is None:
            calendar = pd.DatetimeIndex([])

        trades_df = pd.concat(all_trades, ignore_index=True) if all_trades else pd.DataFrame()
        n_sym = max(1, len([s for s in per_symbol if per_symbol[s].get("trades", 0) > 0]))
        initial_total = capital_per_symbol * n_sym
        port_eq = portfolio_equity_curve(trades_df, initial_total, calendar)
        port_stats = performance_summary(
            trades_df,
            initial_total,
            float(port_eq.iloc[-1]) if len(port_eq) else initial_total,
        )

        summary["scenarios"][scen_name] = {
            "portfolio": port_stats,
            "per_symbol": per_symbol,
            "n_symbols_traded": n_sym,
        }

        if not port_eq.empty:
            port_eq.to_csv(ARTIFACT_DIR / f"equity_{scen_name}.csv")
            port_eq.to_csv(NOTEBOOK_OUT / f"equity_{scen_name}.csv")

        trades_df.to_csv(ARTIFACT_DIR / f"trades_{scen_name}.csv", index=False)

        # Equity curve chart
        fig, ax = plt.subplots(figsize=(10, 5))
        ax.plot(port_eq.index, port_eq.values, label=f"Portfolio ({scen_name})", linewidth=1.8)
        ax.set_title(f"Zarattini ORB — Orbis liquid universe ({period})")
        ax.set_ylabel("Equity ($)")
        ax.legend()
        ax.grid(True, alpha=0.3)
        fig.tight_layout()
        fig.savefig(ARTIFACT_DIR / f"equity_curve_{scen_name}.png", dpi=140)
        fig.savefig(NOTEBOOK_OUT / f"equity_curve_{scen_name}.png", dpi=140)
        plt.close(fig)

        if not trades_df.empty:
            fig2, ax2 = plt.subplots(figsize=(8, 4))
            trades_df["exit_reason"].value_counts().plot(kind="bar", ax=ax2, color="#2563eb")
            ax2.set_title(f"Exit mix — {scen_name}")
            fig2.tight_layout()
            fig2.savefig(ARTIFACT_DIR / f"exit_mix_{scen_name}.png", dpi=140)
            plt.close(fig2)

    # Compare scenarios on one chart
    fig, ax = plt.subplots(figsize=(11, 5))
    for scen_name in scenarios:
        path = ARTIFACT_DIR / f"equity_{scen_name}.csv"
        if path.exists():
            s = pd.read_csv(path, index_col=0, parse_dates=True).squeeze("columns")
            ax.plot(s.index, s.values, label=scen_name, linewidth=1.6)
    ax.set_title("Zarattini ORB — scenario comparison (Orbis LIQUID + QQQ)")
    ax.set_ylabel("Portfolio equity ($)")
    ax.legend()
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(ARTIFACT_DIR / "equity_curves_all_scenarios.png", dpi=150)
    fig.savefig(NOTEBOOK_OUT / "equity_curves_all_scenarios.png", dpi=150)
    plt.close(fig)

    out_json = ARTIFACT_DIR / "validation_summary.json"
    out_json.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    (NOTEBOOK_OUT / "validation_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    _write_results_md(summary, NOTEBOOK_OUT / "RESULTS.md")
    _write_results_md(summary, ARTIFACT_DIR / "RESULTS.md")
    _symbol_pnl_chart(summary, "slippage_2c", ARTIFACT_DIR / "symbol_pnl_slippage_2c.png")
    _symbol_pnl_chart(summary, "slippage_2c", NOTEBOOK_OUT / "symbol_pnl_slippage_2c.png")

    print(f"\nWrote {out_json}")
    return summary


def _write_results_md(summary: dict, path: Path) -> None:
    lines = [
        "# Zarattini ORB — Orbis LIQUID universe",
        "",
        f"Period: **{summary['period']}** · Symbols: **{len(summary['symbols'])}**",
        "",
        "| Scenario | Trades | Net PnL | Final equity | Win % | Sharpe | Max DD |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for scen, block in summary["scenarios"].items():
        p = block["portfolio"]
        lines.append(
            f"| `{scen}` | {p['trades']} | ${p['net_pnl']:,.0f} | ${p['final_equity']:,.0f} | "
            f"{100 * p['win_rate']:.1f}% | {p['sharpe_daily']:.2f} | {100 * p['max_drawdown']:.1f}% |"
        )
    lines.extend(
        [
            "",
            "Paper research — not investment advice.",
            "",
            "Regenerate: `PYTHONPATH=. python3 -m pipeline.research.run_zarattini_orb_validation`",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def _symbol_pnl_chart(summary: dict, scen: str, path: Path) -> None:
    per = summary["scenarios"].get(scen, {}).get("per_symbol", {})
    if not per:
        return
    df = pd.DataFrame(per).T
    if "net_pnl" not in df.columns:
        return
    df = df.sort_values("net_pnl")
    fig, ax = plt.subplots(figsize=(10, max(4, len(df) * 0.22)))
    colors = ["#dc2626" if v < 0 else "#16a34a" for v in df["net_pnl"]]
    ax.barh(df.index, df["net_pnl"], color=colors)
    ax.axvline(0, color="#666", linewidth=0.8)
    ax.set_xlabel("Net PnL ($) per symbol sleeve ($25k each)")
    ax.set_title(f"Zarattini ORB · {scen} · ~60d Yahoo 5m")
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)


def main() -> None:
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("--period", default="60d")
    p.add_argument("--max-symbols", type=int, default=None)
    p.add_argument("--capital-per-symbol", type=float, default=25_000.0)
    args = p.parse_args()
    run_validation(
        period=args.period,
        max_symbols=args.max_symbols,
        capital_per_symbol=args.capital_per_symbol,
    )


if __name__ == "__main__":
    main()
