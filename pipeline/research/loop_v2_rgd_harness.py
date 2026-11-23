"""Pre-declared LOOP v2 RGD add-on experiment (10 deflated-Sharpe trials)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import pandas as pd

from pipeline.research.donchian_vwap_backtest import benchmark_returns, build_research_panels
from pipeline.research.loop_donchian_harness import STRESS_COSTS, compute_metrics
from pipeline.research.loop_v2_backtest import (
    LoopV2Config,
    _build_breakout_index,
    _precompute_atr,
    _precompute_features,
    _precompute_vol20,
    run_loop_v2,
    summarize_run,
)
from pipeline.research.merged_pit_universe import merged_membership_lookup, union_symbols_between

PERIODS = (
    ("full", date(2010, 1, 4)),
    ("oos", date(2019, 1, 2)),
)
N_TRIALS = 10  # 6 prior LOOP v2 runs + 4 add-on variants
DATA_START = "2009-06-01"


@dataclass(frozen=True)
class RgdVariant:
    run_id: str
    name: str
    use_er_filter: bool = False
    use_vol_switch_channel: bool = False
    use_partial_profit: bool = False


RGD_VARIANTS: list[RgdVariant] = [
    RgdVariant("7", "loop_v2_full", False, False, False),
    RgdVariant("8", "rgd_addon_a_er", True, False, False),
    RgdVariant("9", "rgd_addon_b_vol", False, True, False),
    RgdVariant("10", "rgd_addon_c_partial", False, False, True),
    RgdVariant("11", "rgd_addon_d_all", True, True, True),
]


def _pass_verdict(v2_sharpe: float, v2_mdd: float, spy_sharpe: float, spy_mdd: float) -> bool:
    return v2_sharpe > spy_sharpe and abs(v2_mdd) < abs(spy_mdd)


def _feature_bundle(
    panels: dict[str, pd.DataFrame],
    variant: RgdVariant,
) -> tuple[dict, dict]:
    """Features + breakout index for one variant (add-ons change signal layer)."""
    features = {
        sym: _precompute_features(
            ohlcv,
            use_vol_switch_channel=variant.use_vol_switch_channel,
            use_er_filter=variant.use_er_filter,
        )
        for sym, ohlcv in panels.items()
        if sym != "SPY"
    }
    breakout_index = _build_breakout_index(features, use_er_filter=variant.use_er_filter)
    return features, breakout_index


def run_rgd_all(end: date | None = None, *, quick: bool = False) -> dict:
    if end is None:
        end = date.today()

    lookup = merged_membership_lookup()
    symbols = sorted(union_symbols_between(date(2010, 1, 4), end) | {"SPY"})
    sym_sector = {s: "Unknown" for s in symbols if s != "SPY"}
    try:
        from pipeline.ingest.us_index_universe import build_merged_universe

        for row in build_merged_universe()[0]:
            sym = row["symbol"]
            if sym in sym_sector:
                sym_sector[sym] = row.get("sector") or "Unknown"
    except Exception:
        pass
    panels, _, sym_sector = build_research_panels(
        DATA_START, symbols=symbols, sym_sector=sym_sector
    )
    print("  precomputing shared ATR/vol caches…", flush=True)
    atr_cache = {sym: _precompute_atr(ohlcv) for sym, ohlcv in panels.items() if sym != "SPY"}
    vol20_cache = _precompute_vol20(panels)

    variants = RGD_VARIANTS if not quick else [RGD_VARIANTS[0]]

    daily_by_run: dict[str, pd.Series] = {}
    stats_by_run: dict[str, dict] = {}

    for variant in variants:
        print(f"  features for {variant.name}…", flush=True)
        features, breakout_index = _feature_bundle(panels, variant)
        for cost_label in ("10bps", "25bps"):
            cost = STRESS_COSTS[cost_label]
            key = f"{variant.name}|{cost_label}"
            cfg = LoopV2Config(
                variant.name,
                use_vwap_entry=True,
                use_vwap_stop=True,
                cost=cost,
                use_er_filter=variant.use_er_filter,
                use_vol_switch_channel=variant.use_vol_switch_channel,
                use_partial_profit=variant.use_partial_profit,
            )
            print(f"  run {variant.name} @ {cost_label}…", flush=True)
            daily, stats = run_loop_v2(
                date(2010, 1, 4),
                end,
                config=cfg,
                panels=panels,
                sym_sector=sym_sector,
                membership_lookup=lookup,
                features=features,
                atr_cache=atr_cache,
                breakout_index=breakout_index,
                vol20_cache=vol20_cache,
            )
            daily_by_run[key] = daily
            stats_by_run[key] = stats

    spy_daily = benchmark_returns(date(2010, 1, 4), end, "SPY")
    daily_by_run["SPY|0bps"] = spy_daily

    results: list[dict] = []
    for period_name, pstart in PERIODS:
        spy_slice = spy_daily.loc[
            (spy_daily.index >= pd.Timestamp(pstart)) & (spy_daily.index <= pd.Timestamp(end))
        ]
        spy_row = summarize_run("SPY", spy_daily, pstart, end, n_trials=1)
        spy_row.update(
            {
                "run_id": "6",
                "variant": "SPY",
                "period": period_name,
                "cost": "0bps",
                "turnover": 0.0,
                "avg_holdings": 1.0,
                "pct_time_invested": 100.0,
                "vwap_limit_fill_rate": 0.0,
                "annualized_vol": float(spy_slice.std() * (252**0.5)) if len(spy_slice) > 1 else 0,
                "trade_count": 0,
                "win_rate": 0.0,
                "avg_r_per_trade": 0.0,
            }
        )
        results.append(spy_row)

        for key, daily in daily_by_run.items():
            if key.startswith("SPY"):
                continue
            variant, cost_label = key.split("|", 1)
            run_id = next((v.run_id for v in RGD_VARIANTS if v.name == variant), "?")
            row = summarize_run(
                variant, daily, pstart, end, extra=stats_by_run.get(key), n_trials=N_TRIALS
            )
            row["run_id"] = run_id
            row["variant"] = variant
            row["period"] = period_name
            row["cost"] = cost_label
            results.append(row)

    baseline_full = [
        r
        for r in results
        if r["variant"] == "loop_v2_full" and r["cost"] == "25bps"
    ]
    baseline_sharpe = {r["period"]: r["sharpe"] for r in baseline_full}
    addon_verdicts: dict[str, dict[str, bool]] = {}
    for v in RGD_VARIANTS:
        if v.name == "loop_v2_full":
            continue
        addon_verdicts[v.name] = {}
        for period_name, _ in PERIODS:
            row = next(
                (
                    r
                    for r in results
                    if r["variant"] == v.name and r["period"] == period_name and r["cost"] == "25bps"
                ),
                None,
            )
            b = baseline_sharpe.get(period_name)
            addon_verdicts[v.name][period_name] = (
                row is not None and b is not None and row["sharpe"] > b
            )

    pass_variants: dict[str, bool] = {}
    spy_by_period = {r["period"]: r for r in results if r["variant"] == "SPY"}
    for v in RGD_VARIANTS:
        pf: dict[str, bool] = {}
        for period_name, _ in PERIODS:
            row = next(
                (
                    r
                    for r in results
                    if r["variant"] == v.name and r["period"] == period_name and r["cost"] == "25bps"
                ),
                None,
            )
            spy_r = spy_by_period.get(period_name)
            if row and spy_r:
                pf[period_name] = _pass_verdict(
                    row["sharpe"], row["max_drawdown"], spy_r["sharpe"], spy_r["max_drawdown"]
                )
        pass_variants[v.name] = all(pf.values()) if pf else False

    return {
        "end": end.isoformat(),
        "n_trials_deflated_sharpe": N_TRIALS,
        "results": results,
        "addon_sharpe_improved_vs_v2_full_25bps": addon_verdicts,
        "pass_fail_25bps_vs_spy": pass_variants,
        "pass_overall_best_addon": any(
            pass_variants.get(v.name, False) for v in RGD_VARIANTS if v.name != "loop_v2_full"
        ),
        "data_caveats": [
            "Universe: PIT S&P 500 ∪ Nasdaq-100 (merged_pit_universe).",
            "Add-ons A–D are pre-declared; no parameter tuning after results.",
            "Deflated Sharpe uses n_trials=10 (6 LOOP v2 harness + 4 add-on legs).",
        ],
    }