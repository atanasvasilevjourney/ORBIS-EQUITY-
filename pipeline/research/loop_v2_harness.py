"""Six pre-declared LOOP v2 backtest runs (no post-hoc tuning)."""
from __future__ import annotations

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
    run_baseline_loop,
    run_loop_v2,
    summarize_run,
)
from pipeline.research.merged_pit_universe import merged_membership_lookup, union_symbols_between

PERIODS = (
    ("full", date(2010, 1, 4)),
    ("oos", date(2019, 1, 2)),
)
N_TRIALS = 6
DATA_START = "2009-06-01"

PREDECLARED_VARIANTS: list[tuple[str, str, bool, bool]] = [
    ("1", "loop_v2_full", True, True),
    ("2", "v2_no_vwap_entry", False, True),
    ("3", "v2_no_vwap_stop", True, False),
    ("4", "v2_no_vwap_either", False, False),
]


def _pass_verdict(v2_sharpe: float, v2_mdd: float, spy_sharpe: float, spy_mdd: float) -> bool:
    return v2_sharpe > spy_sharpe and abs(v2_mdd) < abs(spy_mdd)


def run_all(
    end: date | None = None,
    *,
    quick: bool = False,
    skip_baseline: bool = False,
) -> dict:
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
    panels, signals, sym_sector = build_research_panels(
        DATA_START, symbols=symbols, sym_sector=sym_sector
    )
    print("  precomputing features / breakout index…", flush=True)
    features = {sym: _precompute_features(ohlcv) for sym, ohlcv in panels.items() if sym != "SPY"}
    atr_cache = {sym: _precompute_atr(ohlcv) for sym, ohlcv in panels.items() if sym != "SPY"}
    breakout_index = _build_breakout_index(features)
    vol20_cache = _precompute_vol20(panels)

    daily_by_run: dict[str, pd.Series] = {}
    stats_by_run: dict[str, dict] = {}

    for cost_label in ("10bps", "25bps"):
        cost = STRESS_COSTS[cost_label]
        for _id, variant, ent, stp in PREDECLARED_VARIANTS:
            if quick and variant != "loop_v2_full":
                continue
            key = f"{variant}|{cost_label}"
            cfg = LoopV2Config(variant, use_vwap_entry=ent, use_vwap_stop=stp, cost=cost)
            print(f"  variant {variant} @ {cost_label}…", flush=True)
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

        if not quick and not skip_baseline:
            print(f"  baseline LOOP @ {cost_label}…", flush=True)
            bkey = f"baseline_loop|{cost_label}"
            daily, bstats = run_baseline_loop(
                date(2010, 1, 4),
                end,
                panels=panels,
                signals=signals,
                sym_sector=sym_sector,
                membership_lookup=lookup,
                cost=cost,
            )
            daily_by_run[bkey] = daily
            stats_by_run[bkey] = bstats

    spy_daily = benchmark_returns(date(2010, 1, 4), end, "SPY")
    daily_by_run["SPY|0bps"] = spy_daily

    results: list[dict] = []
    for period_name, pstart in PERIODS:
        spy_slice = spy_daily.loc[
            (spy_daily.index >= pd.Timestamp(pstart)) & (spy_daily.index <= pd.Timestamp(end))
        ]
        spy_m = compute_metrics(spy_slice)
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
            }
        )
        results.append(spy_row)

        for key, daily in daily_by_run.items():
            if key.startswith("SPY"):
                continue
            variant, cost_label = key.split("|", 1)
            run_id = next((i for i, v, _, _ in PREDECLARED_VARIANTS if v == variant), "5")
            if variant == "baseline_loop":
                run_id = "5"
            row = summarize_run(variant, daily, pstart, end, extra=stats_by_run.get(key), n_trials=N_TRIALS)
            row["run_id"] = run_id
            row["variant"] = variant
            row["period"] = period_name
            row["cost"] = cost_label
            results.append(row)

    verdicts: dict[str, bool] = {}
    for period_name, pstart in PERIODS:
        v2 = next(
            (
                r
                for r in results
                if r["variant"] == "loop_v2_full" and r["period"] == period_name and r["cost"] == "25bps"
            ),
            None,
        )
        spy_r = next((r for r in results if r["variant"] == "SPY" and r["period"] == period_name), None)
        if v2 and spy_r:
            verdicts[period_name] = _pass_verdict(
                v2["sharpe"], v2["max_drawdown"], spy_r["sharpe"], spy_r["max_drawdown"]
            )

    return {
        "end": end.isoformat(),
        "n_trials_deflated_sharpe": N_TRIALS,
        "results": results,
        "pass_fail_25bps_loop_v2_full": verdicts,
        "pass_overall": all(verdicts.values()) if verdicts else False,
        "data_caveats": [
            "Universe: PIT S&P 500 (fja05680/sp500) ∪ Nasdaq-100 (Wikipedia change log; seed 2008-12-22).",
            "Dual share classes deduped (e.g. GOOGL over GOOG).",
            "NDX history before seed date may retain mild survivorship.",
            "GICS sector caps use live sector map where missing (Unknown bucket).",
            "Prices: yfinance auto_adjust=True.",
        ],
    }