"""Pre-declared Turtle System 1 backtest runs (T1–T4, SPY, LOOP v2 reference)."""
from __future__ import annotations

from datetime import date

import pandas as pd

from pipeline.research.donchian_vwap_backtest import benchmark_returns, build_research_panels
from pipeline.research.loop_donchian_harness import STRESS_COSTS
from pipeline.research.loop_v2_backtest import (
    LoopV2Config,
    _build_breakout_index,
    _precompute_atr,
    _precompute_features,
    _precompute_vol20,
    run_loop_v2,
)
from pipeline.research.loop_v2_harness import summarize_run as summarize_loop_v2
from pipeline.research.merged_pit_universe import merged_membership_lookup, union_symbols_between
from pipeline.research.turtle_s1_backtest import (
    TurtleS1Config,
    build_breakout_index,
    precompute_features,
    run_turtle_s1,
    summarize_run,
)

PERIODS = (
    ("full", date(2010, 1, 4)),
    ("oos", date(2019, 1, 2)),
)
N_TRIALS = 14
DATA_START = "2009-06-01"

def _variants() -> list[tuple[str, str, TurtleS1Config]]:
    return [
        ("T1", "turtle_s1_t1", TurtleS1Config("turtle_s1_t1")),
        (
            "T2",
            "turtle_s1_t2",
            TurtleS1Config("turtle_s1_t2", use_sma200_filter=True),
        ),
        (
            "T3",
            "turtle_s1_t3",
            TurtleS1Config("turtle_s1_t3", allow_pyramid=True),
        ),
        (
            "T4",
            "turtle_s1_t4",
            TurtleS1Config("turtle_s1_t4", use_skip_rule=False),
        ),
    ]


def _pass_verdict(var_sharpe: float, var_mdd: float, spy_sharpe: float, spy_mdd: float) -> bool:
    return var_sharpe > spy_sharpe and abs(var_mdd) < abs(spy_mdd)


def _slice_trade_stats(extra: dict | None, start: date, end: date) -> dict:
    if not extra or not extra.get("trades"):
        return {
            "trade_count": 0,
            "win_rate": 0.0,
            "avg_holding_days": 0.0,
            "avg_r_multiple": 0.0,
            "payoff_ratio": 0.0,
        }
    trades = [
        t
        for t in extra["trades"]
        if start <= date.fromisoformat(t["exit_day"]) <= end
    ]
    if not trades:
        return {
            "trade_count": 0,
            "win_rate": 0.0,
            "avg_holding_days": 0.0,
            "avg_r_multiple": 0.0,
            "payoff_ratio": 0.0,
        }
    wins = [t for t in trades if t["win"]]
    losses = [t for t in trades if not t["win"]]
    avg_win = sum(t["r_multiple"] for t in wins) / len(wins) if wins else 0.0
    avg_loss = sum(abs(t["r_multiple"]) for t in losses) / len(losses) if losses else 0.0
    return {
        "trade_count": len(trades),
        "win_rate": 100.0 * len(wins) / len(trades),
        "avg_holding_days": float(sum(t["holding_days"] for t in trades) / len(trades)),
        "avg_r_multiple": float(sum(t["r_multiple"] for t in trades) / len(trades)),
        "payoff_ratio": avg_win / avg_loss if avg_loss > 0 else 0.0,
    }


def run_all(
    end: date | None = None,
    *,
    quick: bool = False,
    skip_loop_v2: bool = False,
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
    print("  precomputing turtle features…", flush=True)
    t_features = {
        sym: precompute_features(ohlcv) for sym, ohlcv in panels.items() if sym != "SPY"
    }
    t_breakouts = {
        var_name: build_breakout_index(
            t_features, use_sma200_filter=cfg.use_sma200_filter
        )
        for _id, var_name, cfg in _variants()
    }

    loop_features = None
    loop_atr = None
    loop_breakout = None
    loop_vol20 = None
    if not skip_loop_v2 and not quick:
        print("  precomputing LOOP v2 features…", flush=True)
        loop_features = {
            sym: _precompute_features(ohlcv) for sym, ohlcv in panels.items() if sym != "SPY"
        }
        loop_atr = {
            sym: _precompute_atr(ohlcv) for sym, ohlcv in panels.items() if sym != "SPY"
        }
        loop_breakout = _build_breakout_index(loop_features)
        loop_vol20 = _precompute_vol20(panels)

    daily_by_run: dict[str, pd.Series] = {}
    stats_by_run: dict[str, dict] = {}

    for cost_label in ("10bps", "25bps"):
        cost = STRESS_COSTS[cost_label]
        for run_id, var_name, base_cfg in _variants():
            if quick and var_name != "turtle_s1_t1":
                continue
            key = f"{var_name}|{cost_label}"
            cfg = TurtleS1Config(
                base_cfg.name,
                use_skip_rule=base_cfg.use_skip_rule,
                use_sma200_filter=base_cfg.use_sma200_filter,
                allow_pyramid=base_cfg.allow_pyramid,
                cost=cost,
            )
            print(f"  {var_name} @ {cost_label}…", flush=True)
            daily, stats = run_turtle_s1(
                date(2010, 1, 4),
                end,
                config=cfg,
                panels=panels,
                membership_lookup=lookup,
                features=t_features,
                breakout_index=t_breakouts[var_name],
            )
            daily_by_run[key] = daily
            stats_by_run[key] = stats

        if not quick and not skip_loop_v2:
            key = f"loop_v2_full|{cost_label}"
            cfg = LoopV2Config("loop_v2_full", use_vwap_entry=True, use_vwap_stop=True, cost=cost)
            print(f"  loop_v2_full @ {cost_label}…", flush=True)
            daily, stats = run_loop_v2(
                date(2010, 1, 4),
                end,
                config=cfg,
                panels=panels,
                sym_sector=sym_sector,
                membership_lookup=lookup,
                features=loop_features,
                atr_cache=loop_atr,
                breakout_index=loop_breakout,
                vol20_cache=loop_vol20,
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
                "run_id": "SPY",
                "variant": "SPY",
                "period": period_name,
                "cost": "0bps",
                "turnover": 0.0,
                "avg_holdings": 1.0,
                "pct_time_invested": 100.0,
                "annualized_vol": float(spy_slice.std() * (252**0.5)) if len(spy_slice) > 1 else 0,
            }
        )
        results.append(spy_row)

        for key, daily in daily_by_run.items():
            if key.startswith("SPY"):
                continue
            variant, cost_label = key.split("|", 1)
            run_id = next((i for i, v, _ in _variants() if v == variant), "loop_v2_full")
            if variant == "loop_v2_full":
                row = summarize_loop_v2(
                    variant, daily, pstart, end, extra=stats_by_run.get(key), n_trials=N_TRIALS
                )
            else:
                extra = dict(stats_by_run.get(key) or {})
                extra.update(_slice_trade_stats(extra, pstart, end))
                row = summarize_run(variant, daily, pstart, end, extra=extra, n_trials=N_TRIALS)
            row["run_id"] = run_id
            row["variant"] = variant
            row["period"] = period_name
            row["cost"] = cost_label
            results.append(row)

    verdicts: dict[str, dict[str, bool]] = {}
    for run_id, variant, _ in _variants():
        verdicts[variant] = {}
        for period_name, pstart in PERIODS:
            var_r = next(
                (
                    r
                    for r in results
                    if r["variant"] == variant and r["period"] == period_name and r["cost"] == "25bps"
                ),
                None,
            )
            spy_r = next(
                (r for r in results if r["variant"] == "SPY" and r["period"] == period_name),
                None,
            )
            if var_r and spy_r:
                verdicts[variant][period_name] = _pass_verdict(
                    var_r["sharpe"], var_r["max_drawdown"], spy_r["sharpe"], spy_r["max_drawdown"]
                )

    skip_note: dict = {}
    t1 = stats_by_run.get("turtle_s1_t1|25bps")
    t4 = stats_by_run.get("turtle_s1_t4|25bps")
    t1_row = next((r for r in results if r["variant"] == "turtle_s1_t1" and r["period"] == "full" and r["cost"] == "25bps"), None)
    t4_row = next((r for r in results if r["variant"] == "turtle_s1_t4" and r["period"] == "full" and r["cost"] == "25bps"), None)
    if t1 and t4:
        skip_note = {
            "skip_signals_fired": t1.get("skip_signals", 0),
            "skip_opportunities": t1.get("skip_rule_opportunities", 0),
            "t1_sharpe_full_25bps": t1_row.get("sharpe") if t1_row else None,
            "t4_sharpe_full_25bps": t4_row.get("sharpe") if t4_row else None,
            "skip_helped_sharpe": (t1_row.get("sharpe", 0) > t4_row.get("sharpe", 0))
            if t1_row and t4_row
            else None,
        }

    return {
        "end": end.isoformat(),
        "n_trials_deflated_sharpe": N_TRIALS,
        "results": results,
        "pass_fail_25bps_by_variant": verdicts,
        "skip_rule_analysis": skip_note,
        "_daily_by_run": daily_by_run,
        "data_caveats": [
            "Universe: PIT S&P 500 ∪ Nasdaq-100; price ≥ $10; GOOG/GOOGL deduped.",
            "Daily bars; signals on close, fills at next open.",
            "Costs: 10 and 25 bps per side (commission + slippage).",
            "N = ATR(20) at entry; stop 2N; System 1 channel 20/10.",
            "Prices: yfinance auto_adjust=True.",
            "Reference: algomaya.com Turtle System 1 Donchian rules (research reproduction).",
        ],
    }