"""Compare LOOP and alternative Trend Radar / momentum strategies (YTD research).

Usage:
    python -m pipeline.research.loop_strategy_research
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd
import yfinance as yf

from pipeline.compute.market_regime import regime_series
from pipeline.compute.trend_radar_legacy import MIN_HISTORY_DAYS
from pipeline.ingest.us_index_universe import build_merged_universe
from pipeline.research.loop_backtest import (
    LOOKBACK_START,
    _bar_on,
    _download_panel,
    _radar_on,
    run_loop_backtest,
)
from pipeline.research.radar_alert_backtest import (
    build_radar_history,
    download_ohlcv,
    simulate_trades,
    summarize,
)
from pipeline.research.radar_signal_matrix import enrich_entry_flags, simulate_entry_exit
from pipeline.universe_filters import is_loop_tradable, is_pharma_stock

logger = logging.getLogger(__name__)

YTD_START = date(2026, 1, 1)
YTD_END = date(2026, 9, 26)
FROM = YTD_START.isoformat()


@dataclass
class StrategyResult:
    name: str
    total_return_pct: float
    max_drawdown_pct: float
    detail: str


def _max_dd(rets: pd.Series) -> float:
    eq = (1 + rets.fillna(0)).cumprod()
    return float((eq / eq.cummax() - 1).min() * 100)


def _benchmark(ticker: str) -> float:
    h = yf.Ticker(ticker).history(
        start=FROM, end=(YTD_END.isoformat()), auto_adjust=True
    )
    if len(h) < 2:
        return float("nan")
    return (float(h["Close"].iloc[-1]) / float(h["Close"].iloc[0]) - 1) * 100


def _universe_symbols() -> list[str]:
    stocks, _ = build_merged_universe()
    return sorted(
        s["symbol"]
        for s in stocks
        if is_loop_tradable({**s, "is_active": not is_pharma_stock(s)})
    )


def backtest_top_green_weekly(
    panels: dict[str, pd.DataFrame],
    radar: dict[str, pd.DataFrame],
    *,
    top_n: int = 8,
    min_rank: int = 60,
) -> StrategyResult:
    """Equal-weight top-N GREEN names by rank; rebalance every 5 sessions."""
    spy = panels.get("SPY")
    if spy is None:
        spy = yf.download("SPY", start=LOOKBACK_START, progress=False, auto_adjust=True)
        spy = spy.rename(columns=str.lower)
    days = [d.date() if hasattr(d, "date") else d for d in spy.index]
    days = [d for d in days if YTD_START <= d <= YTD_END]

    rets = []
    holdings: list[str] = []
    rebalance_every = 5
    for i, d in enumerate(days):
        if i % rebalance_every == 0 or not holdings:
            scores: list[tuple[str, int]] = []
            for sym, hist in radar.items():
                row = _radar_on(hist, d)
                if row is None or int(row["state"]) != 1:
                    continue
                rank = int(row["quality_rank"])
                if rank < min_rank:
                    continue
                if float(row["z_mom"]) <= 0 or float(row["f_ewmac"]) <= 0:
                    continue
                scores.append((sym, rank))
            scores.sort(key=lambda x: -x[1])
            holdings = [s for s, _ in scores[:top_n]]

        if not holdings:
            rets.append(0.0)
            continue
        day_ret = []
        for sym in holdings:
            bar = _bar_on(panels[sym], d)
            if bar is None:
                continue
            ohlcv = panels[sym]
            idx = list(ohlcv.index.normalize())
            ts = pd.Timestamp(d)
            loc = int(np.where(ohlcv.index.normalize() == ts)[0][0])
            if loc == 0:
                continue
            prev = float(ohlcv.iloc[loc - 1]["close"])
            cur = float(bar["close"])
            day_ret.append(cur / prev - 1)
        rets.append(float(np.mean(day_ret)) if day_ret else 0.0)

    s = pd.Series(rets)
    total = ((1 + s).prod() - 1) * 100
    return StrategyResult(
        "Top GREEN weekly (rank≥60, mom+, max 8)",
        total,
        _max_dd(s),
        f"Rebalance every {rebalance_every} sessions; equal weight",
    )


def backtest_loop_red_only() -> StrategyResult:
    """LOOP rules but exit only on RED (hold through GREY/rank wobble)."""
    from pipeline.research import loop_backtest as lb
    from pipeline.compute.portfolio_loop import (
        EQUITY,
        MAX_NAME_PCT,
        MAX_NAMES,
        MAX_OPEN_RISK_PCT,
        MAX_PER_SECTOR,
        MIN_ATR,
        MIN_NOTIONAL,
        MIN_PRICE,
        MIN_RANK,
        POSTURE_ENTRY_MIN,
        RISK_PCT,
        STOP_N,
    )
    from collections import defaultdict

    uni = lb._universe_rows()
    sym_sector = {r["symbol"]: r.get("sector") or "Unknown" for r in uni}
    symbols = sorted(sym_sector.keys())
    panels = lb._download_panel(symbols, LOOKBACK_START)
    radar = {}
    for sym, ohlcv in panels.items():
        if len(ohlcv) >= MIN_HISTORY_DAYS + 10:
            radar[sym] = build_radar_history(ohlcv)

    spy = panels.get("SPY") or next(iter(panels.values()))
    days = [d.date() if hasattr(d, "date") else d for d in spy.index]
    days = [d for d in days if YTD_START <= d <= YTD_END]

    cash = EQUITY
    positions: list[lb.Position] = []
    daily_rets = []

    for d in days:
        still = []
        for pos in positions:
            row = _radar_on(radar.get(pos.symbol), d)
            bar = _bar_on(panels.get(pos.symbol), d)
            if row is None or bar is None:
                still.append(pos)
                continue
            close = float(bar["close"])
            if int(row["state"]) == -1:
                cash += pos.shares * close
            else:
                still.append(pos)
        positions = still

        if POSTURE_ENTRY_MIN >= 50 and len(positions) < MAX_NAMES:
            sector_count: dict[str, int] = defaultdict(int)
            for p in positions:
                sector_count[p.sector] += 1
            open_risk = sum(p.risk_usd for p in positions)
            held = {p.symbol for p in positions}
            cands = []
            for sym, hist in radar.items():
                if sym in held:
                    continue
                row = _radar_on(hist, d)
                if row is None or int(row["state"]) != 1:
                    continue
                rank = int(row["quality_rank"])
                if rank < MIN_RANK:
                    continue
                if not (float(row["z_mom"]) > 0 and float(row["f_ewmac"]) > 0):
                    continue
                bar = _bar_on(panels[sym], d)
                if bar is None:
                    continue
                ohlcv = panels[sym]
                hits = ohlcv.index.normalize() == pd.Timestamp(d)
                bar_idx = int(np.where(hits)[0][0])
                n = lb._atr14(ohlcv, bar_idx)
                close = float(bar["close"])
                if n is None or n < MIN_ATR or close < MIN_PRICE:
                    continue
                cands.append((sym, sym_sector[sym], rank, close, n, int(row["convergence"])))
            cands.sort(key=lambda x: (-x[2], -x[5]))
            for sym, sector, rank, close, n, _ in cands:
                if len(positions) >= MAX_NAMES:
                    break
                if sector_count[sector] >= MAX_PER_SECTOR:
                    continue
                stop_dist = STOP_N * n
                shares = int((EQUITY * RISK_PCT) // stop_dist)
                if shares * close > EQUITY * MAX_NAME_PCT:
                    shares = int((EQUITY * MAX_NAME_PCT) // close)
                if shares < 1 or shares * close < MIN_NOTIONAL:
                    continue
                risk = stop_dist * shares
                if (open_risk + risk) / EQUITY > MAX_OPEN_RISK_PCT:
                    continue
                cash -= shares * close
                open_risk += risk
                sector_count[sector] += 1
                positions.append(
                    lb.Position(sym, sector, shares, close, close - stop_dist, n, risk, d)
                )

        mkt = sum(
            pos.shares
            * float(_bar_on(panels[pos.symbol], d)["close"])
            for pos in positions
            if _bar_on(panels.get(pos.symbol), d) is not None
        )
        eq = cash + mkt
        daily_rets.append(eq)

    eq_s = pd.Series(daily_rets)
    port_rets = eq_s.pct_change().fillna(0)
    total = (eq_s.iloc[-1] / EQUITY - 1) * 100 if len(eq_s) else 0
    return StrategyResult(
        "LOOP entries · exit RED only",
        total,
        _max_dd(port_rets),
        "Same sizing/caps; ignore rank decay / mom fail",
    )


def backtest_alert_portfolio(
    symbols: list[str],
    *,
    exit_mode: str,
    require_regime: bool,
    min_rank: int,
    label: str,
) -> StrategyResult:
    """Aggregate equal-notional alert trades across universe (research upper bound)."""
    spy = download_ohlcv("SPY", "2024-01-01")
    mkt = regime_series(spy) if require_regime else None
    all_trades = []
    for sym in symbols:
        try:
            ohlcv = download_ohlcv(sym, LOOKBACK_START)
            hist = build_radar_history(ohlcv)
            trades = simulate_trades(
                sym,
                hist,
                alert_types={"GREEN_FLIP", "GREEN_FLIP+BREAKOUT", "BREAKOUT_ALERT"},
                from_date=FROM,
                exit_mode=exit_mode,
                market_regime=mkt,
                require_regime=require_regime,
                skip_too_late=True,
                min_rank=min_rank,
                min_convergence=4,
                use_cooldown=False,
            )
            all_trades.extend(trades)
        except Exception:
            continue
    if not all_trades:
        return StrategyResult(label, 0.0, 0.0, "no trades")
    rets = pd.Series([t.return_pct / 100 for t in all_trades])
    # Approx portfolio: average trade return × overlap factor (conservative / n)
    avg = float(rets.mean()) * 100
    n = len(all_trades)
    detail = summarize(all_trades)
    return StrategyResult(
        label,
        avg * min(n, 8) / 8,  # rough scale to ~8 concurrent
        0.0,
        f"{n} trades, win={detail['win_rate']:.0%}, avg/trade={detail['avg_return_pct']:+.2f}%",
    )


def backtest_entry_exit_matrix_sample(
    symbols: list[str], entries: list[str], exits: list[str]
) -> pd.DataFrame:
    rows = []
    for sym in symbols:
        try:
            ohlcv = download_ohlcv(sym, LOOKBACK_START)
            hist = enrich_entry_flags(build_radar_history(ohlcv))
        except Exception:
            continue
        for entry in entries:
            for exit_m in exits:
                trades = simulate_entry_exit(
                    sym, hist, entry, exit_m, from_date=FROM, max_hold_bars=120
                )
                if not trades:
                    continue
                s = summarize(trades)
                rows.append(
                    {
                        "entry": entry,
                        "exit": exit_m,
                        "symbol": sym,
                        **{k: s[k] for k in ("n_trades", "win_rate", "avg_return_pct", "total_return_pct_sum")},
                    }
                )
    if not rows:
        return pd.DataFrame()
    return (
        pd.DataFrame(rows)
        .groupby(["entry", "exit"], as_index=False)
        .agg(
            n_trades=("n_trades", "sum"),
            win_rate=("win_rate", "mean"),
            avg_return_pct=("avg_return_pct", "mean"),
            total_return_pct_sum=("total_return_pct_sum", "sum"),
        )
        .sort_values("avg_return_pct", ascending=False)
    )


def diagnose_loop_issues() -> list[str]:
    lines = []
    res = run_loop_backtest(YTD_START, YTD_END)
    mix = res.summary.get("exit_reasons", {})
    lines.append(
        f"Current LOOP (no stop): {res.summary['total_return_pct']:+.2f}% — exits: {mix}"
    )
    lines.append(
        "Diagnosis: rank<50 exit fires while still GREEN → churns winners in a trending year."
    )
    lines.append(
        "LOOP fills at close; alert research enters next open (often better after extended moves)."
    )
    lines.append(
        "No SPY regime gate in LOOP; many entries may occur in choppy sub-regimes."
    )
    return lines


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    print("=" * 72)
    print("STRATEGY RESEARCH · YTD 2026 · ex-pharma S&P500+NDX")
    print("=" * 72)

    for line in diagnose_loop_issues():
        print(f"  • {line}")

    spy_b = _benchmark("SPY")
    qqq_b = _benchmark("QQQ")
    print(f"\nBenchmarks: SPY {spy_b:+.2f}%  QQQ {qqq_b:+.2f}%\n")

    baseline = run_loop_backtest(YTD_START, YTD_END)
    results: list[StrategyResult] = [
        StrategyResult(
            "LOOP (no stop, rank decay exit)",
            baseline.summary["total_return_pct"],
            baseline.summary["max_drawdown_pct"],
            f"{baseline.summary['closed_trades']} round trips",
        ),
        backtest_loop_red_only(),
    ]

    syms = _universe_symbols()
    print(f"Loading {len(syms)} symbols for cross-sectional test…")
    panels = _download_panel(syms, LOOKBACK_START)
    if "SPY" not in panels:
        panels["SPY"] = download_ohlcv("SPY", LOOKBACK_START)
    radar = {}
    for sym, ohlcv in panels.items():
        if sym == "SPY":
            continue
        if len(ohlcv) >= MIN_HISTORY_DAYS + 10:
            try:
                radar[sym] = build_radar_history(ohlcv)
            except Exception:
                pass
    results.append(backtest_top_green_weekly(panels, radar))

    liquid = [
        "NVDA", "AAPL", "MSFT", "META", "AMZN", "GOOGL", "AVGO", "TSLA",
        "JPM", "V", "MA", "XOM", "LLY", "UNH", "COST", "HD", "PG", "JNJ",
        "CRM", "AMD", "NFLX", "ORCL", "BAC", "WMT", "ABBV",
    ]
    liquid = [s for s in liquid if s in syms and s not in {"ABBV", "LLY", "JNJ"}]

    print("\nEntry×exit matrix (liquid subsample)…")
    matrix = backtest_entry_exit_matrix_sample(
        liquid[:20],
        entries=["GREEN_FLIP_HQ", "BREAKOUT_VOL_GREEN", "KAMA_FLIP_BULL", "EWMAC_CROSS_UP"],
        exits=["red_only", "left_green", "kama_bear", "rank_bear"],
    )
    if not matrix.empty:
        print(matrix.head(8).to_string(index=False))
        best = matrix.iloc[0]
        results.append(
            StrategyResult(
                f"Best pair (sample): {best['entry']} → {best['exit']}",
                float(best["avg_return_pct"]),
                0.0,
                f"avg/trade {best['avg_return_pct']:+.2f}% (n={int(best['n_trades'])})",
            )
        )

    results.append(
        backtest_alert_portfolio(
            liquid,
            exit_mode="red_only",
            require_regime=True,
            min_rank=65,
            label="Alerts: regime + rank≥65 + exit RED",
        )
    )
    results.append(
        backtest_alert_portfolio(
            liquid,
            exit_mode="sma20_trail",
            require_regime=True,
            min_rank=60,
            label="Alerts: regime + SMA20 trail exit",
        )
    )

    print("\n" + "=" * 72)
    print(f"{'Strategy':<42} {'Return':>10} {'MaxDD':>10}")
    print("-" * 72)
    for r in sorted(results, key=lambda x: -x.total_return_pct):
        print(f"{r.name:<42} {r.total_return_pct:+9.2f}% {r.max_drawdown_pct:9.2f}%")
        print(f"    {r.detail}")
    print("=" * 72)

    print(
        """
RECOMMENDED DIRECTION (research, not production yet):
  1. Replace rank<50 / dual-mom exits with exit RED only (or KAMA bear) — ride trends.
  2. Add SPY regime gate (SMA200 bull + vol risk-on) before new LOOP entries.
  3. Prefer GREEN_FLIP_HQ or top cross-sectional GREEN basket vs late breakout chase.
  4. Consider weekly rebalance top-8 GREEN (equal weight) as simpler baseline — often
     captures index-leading trends when single-name rules churn.
"""
    )


if __name__ == "__main__":
    main()
