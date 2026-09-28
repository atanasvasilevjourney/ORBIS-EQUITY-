"""Historical backtest for LOOP (Trend Radar paper harness rules).

Universe: S&P 500 ∪ Nasdaq-100, excluding pharma/biotech (same as production LOOP).

Usage:
    python -m pipeline.research.loop_backtest
    python -m pipeline.research.loop_backtest --start 2026-01-01 --end 2026-09-26
"""
from __future__ import annotations

import argparse
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

import numpy as np
import pandas as pd
import yfinance as yf

from pipeline.compute.donchian_vwap import EQUITY, MAX_PER_SECTOR, MIN_PRICE, TOP_N
from pipeline.compute.trend_radar import ATR_WINDOW

# Legacy Trend-Radar LOOP simulation constants (production LOOP is Donchian now)
MAX_NAMES = TOP_N
MAX_NAME_PCT = 0.15
MAX_OPEN_RISK_PCT = 0.08
MIN_ATR = 0.25
MIN_NOTIONAL = 500.0
MIN_RANK = 60
POSTURE_ENTRY_MIN = 50
RISK_PCT = 0.01
STOP_N = 2.0
from pipeline.ingest.us_index_universe import build_merged_universe
from pipeline.research.radar_alert_backtest import build_radar_history
from pipeline.universe_filters import is_loop_tradable, is_pharma_stock

logger = logging.getLogger(__name__)

LOOKBACK_START = "2024-08-01"  # MIN_HISTORY_DAYS before 2026-01-01


@dataclass
class Position:
    symbol: str
    sector: str
    shares: int
    entry: float
    stop: float
    n: float
    risk_usd: float
    opened: date


@dataclass
class BacktestResult:
    equity_curve: pd.DataFrame
    trades: pd.DataFrame
    summary: dict


def _universe_rows() -> list[dict]:
    stocks, _ = build_merged_universe()
    rows = []
    for s in stocks:
        pharma = is_pharma_stock(s)
        rows.append(
            {
                **s,
                "is_active": not pharma,
            }
        )
    return [r for r in rows if is_loop_tradable(r)]


def _download_panel(symbols: list[str], start: str) -> dict[str, pd.DataFrame]:
    """Batch OHLCV per symbol via yfinance."""
    if not symbols:
        return {}
    chunk = 80
    panels: dict[str, pd.DataFrame] = {}
    for i in range(0, len(symbols), chunk):
        batch = symbols[i : i + chunk]
        raw = yf.download(
            batch,
            start=start,
            progress=False,
            auto_adjust=True,
            group_by="ticker",
            threads=True,
        )
        if raw.empty:
            continue
        if len(batch) == 1:
            sym = batch[0]
            df = raw.rename(columns=str.lower)[["open", "high", "low", "close", "volume"]].copy()
            df = df.dropna()
            if not df.empty:
                panels[sym] = df
            continue
        for sym in batch:
            try:
                sub = raw[sym].rename(columns=str.lower)
                sub = sub[["open", "high", "low", "close", "volume"]].dropna()
                if not sub.empty:
                    panels[sym] = sub
            except (KeyError, TypeError):
                continue
    return panels


def _bar_on(df: pd.DataFrame, d: date) -> pd.Series | None:
    idx = df.index
    if getattr(idx, "tz", None) is not None:
        idx = idx.tz_localize(None)
        df = df.copy()
        df.index = idx
    hits = df.index.normalize() == pd.Timestamp(d)
    if not hits.any():
        return None
    return df.loc[hits].iloc[0]


def _radar_on(hist: pd.DataFrame, d: date) -> pd.Series | None:
    idx = hist.index
    if getattr(idx, "tz", None) is not None:
        idx = idx.tz_localize(None)
        hist = hist.copy()
        hist.index = idx
    hits = hist.index.normalize() == pd.Timestamp(d)
    if not hits.any():
        return None
    return hist.loc[hits].iloc[0]


def _atr14(df: pd.DataFrame, idx: int) -> float | None:
    if idx < ATR_WINDOW:
        return None
    window = df.iloc[idx - ATR_WINDOW + 1 : idx + 1]
    high = window["high"].astype(float)
    low = window["low"].astype(float)
    close = window["close"].astype(float)
    prev = close.shift(1)
    tr = pd.concat([high - low, (high - prev).abs(), (low - prev).abs()], axis=1).max(axis=1)
    val = float(tr.mean())
    return val if val > 0 else None


def run_loop_backtest(
    start: date,
    end: date,
    *,
    posture: int = POSTURE_ENTRY_MIN,
    initial_equity: float = EQUITY,
) -> BacktestResult:
    uni = _universe_rows()
    sym_sector = {r["symbol"]: r.get("sector") or "Unknown" for r in uni}
    symbols = sorted(sym_sector.keys())

    logger.info("Downloading OHLCV for %d symbols…", len(symbols))
    panels = _download_panel(symbols, LOOKBACK_START)
    logger.info("Got prices for %d symbols", len(panels))

    logger.info("Building Trend Radar histories…")
    radar: dict[str, pd.DataFrame] = {}
    for sym, ohlcv in panels.items():
        if len(ohlcv) < 160:
            continue
        try:
            radar[sym] = build_radar_history(ohlcv)
        except Exception:
            logger.exception("radar failed for %s", sym)

    if "SPY" not in panels:
        spy = yf.download("SPY", start=LOOKBACK_START, progress=False, auto_adjust=True)
        if not spy.empty:
            panels["SPY"] = spy.rename(columns=str.lower)[
                ["open", "high", "low", "close", "volume"]
            ].dropna()

    cal = panels.get("SPY")
    if cal is None:
        # fallback calendar from any liquid name
        cal = next(iter(panels.values()))
    days = [d.date() if hasattr(d, "date") else d for d in cal.index]
    days = [d for d in days if start <= d <= end]

    cash = initial_equity
    positions: list[Position] = []
    trades: list[dict] = []
    curve_rows: list[dict] = []

    for d in days:
        # --- exits ---
        still: list[Position] = []
        for pos in positions:
            hist = radar.get(pos.symbol)
            row = _radar_on(hist, d) if hist is not None else None
            bar = _bar_on(panels[pos.symbol], d) if pos.symbol in panels else None
            if row is None or bar is None:
                still.append(pos)
                continue
            low = float(bar["low"])
            close = float(bar["close"])
            exit_px = None
            reason = None
            if int(row["state"]) == -1:
                exit_px = close
                reason = "state_red"
            elif int(row["quality_rank"]) < 50:
                exit_px = close
                reason = "rank_decay"
            elif float(row["z_mom"]) < 0 and float(row["f_ewmac"]) < 0:
                exit_px = close
                reason = "momentum_fail"

            if exit_px is not None:
                cash += pos.shares * exit_px
                pnl = (exit_px - pos.entry) * pos.shares
                trades.append(
                    {
                        "symbol": pos.symbol,
                        "entry_date": pos.opened.isoformat(),
                        "exit_date": d.isoformat(),
                        "entry": pos.entry,
                        "exit": exit_px,
                        "shares": pos.shares,
                        "pnl_usd": pnl,
                        "return_pct": (exit_px / pos.entry - 1) * 100,
                        "exit_reason": reason,
                    }
                )
            else:
                still.append(pos)
        positions = still

        # --- entries (EOD close fills) ---
        if posture >= POSTURE_ENTRY_MIN and len(positions) < MAX_NAMES:
            sector_count: dict[str, int] = defaultdict(int)
            for p in positions:
                sector_count[p.sector] += 1
            open_risk = sum(p.risk_usd for p in positions)

            candidates: list[dict] = []
            held = {p.symbol for p in positions}
            for sym, hist in radar.items():
                if sym not in sym_sector or sym in held:
                    continue
                row = _radar_on(hist, d)
                if row is None:
                    continue
                if int(row["state"]) != 1:
                    continue
                rank = int(row["quality_rank"])
                if rank < MIN_RANK:
                    continue
                if not (float(row["z_mom"]) > 0 and float(row["f_ewmac"]) > 0):
                    continue
                brk = bool(row["breakout_active"])
                vol = bool(row["volume_confirmed"])
                if not (brk or vol):
                    z52 = float(row["z_52"])
                    if not (rank >= 65 and z52 > -0.10):
                        continue
                ohlcv = panels[sym]
                bar = _bar_on(ohlcv, d)
                if bar is None:
                    continue
                # integer location for ATR window
                hits = ohlcv.index.normalize() == pd.Timestamp(d)
                bar_idx = int(np.where(hits)[0][0])
                n = _atr14(ohlcv, bar_idx)
                close = float(bar["close"])
                if n is None or n < MIN_ATR or close < MIN_PRICE:
                    continue
                candidates.append(
                    {
                        "symbol": sym,
                        "sector": sym_sector[sym],
                        "rank": rank,
                        "close": close,
                        "n": n,
                        "conv": int(row["convergence"]),
                        "vol": vol,
                        "z52": float(row["z_52"]),
                    }
                )

            candidates.sort(
                key=lambda c: (c["rank"], c["conv"], c["vol"], c["z52"]),
                reverse=True,
            )

            for c in candidates:
                if len(positions) >= MAX_NAMES:
                    break
                if sector_count[c["sector"]] >= MAX_PER_SECTOR:
                    continue
                stop_dist = STOP_N * c["n"]
                shares = int((initial_equity * RISK_PCT) // stop_dist)
                notional = shares * c["close"]
                if notional > initial_equity * MAX_NAME_PCT:
                    shares = int((initial_equity * MAX_NAME_PCT) // c["close"])
                    notional = shares * c["close"]
                if shares < 1 or notional < MIN_NOTIONAL:
                    continue
                risk_usd = stop_dist * shares
                if (open_risk + risk_usd) / initial_equity > MAX_OPEN_RISK_PCT:
                    continue
                stop = c["close"] - stop_dist
                cost = shares * c["close"]
                cash -= cost
                open_risk += risk_usd
                sector_count[c["sector"]] += 1
                positions.append(
                    Position(
                        symbol=c["symbol"],
                        sector=c["sector"],
                        shares=shares,
                        entry=c["close"],
                        stop=stop,
                        n=c["n"],
                        risk_usd=risk_usd,
                        opened=d,
                    )
                )
                trades.append(
                    {
                        "symbol": c["symbol"],
                        "entry_date": d.isoformat(),
                        "exit_date": "",
                        "entry": c["close"],
                        "exit": np.nan,
                        "shares": shares,
                        "pnl_usd": np.nan,
                        "return_pct": np.nan,
                        "exit_reason": "OPEN",
                    }
                )

        mkt = 0.0
        for pos in positions:
            bar = _bar_on(panels[pos.symbol], d) if pos.symbol in panels else None
            if bar is None:
                mkt += pos.shares * pos.entry
                continue
            close = float(bar["close"])
            mkt += pos.shares * close
        eq = cash + mkt
        curve_rows.append(
            {
                "date": d,
                "equity_usd": eq,
                "cash_usd": cash,
                "market_value_usd": mkt,
                "return_pct": (eq / initial_equity - 1) * 100,
                "open_names": len(positions),
            }
        )

    curve = pd.DataFrame(curve_rows)
    closed = pd.DataFrame([t for t in trades if t["exit_reason"] != "OPEN"])
    win = (closed["pnl_usd"] > 0).mean() * 100 if len(closed) else 0.0
    exit_mix = closed["exit_reason"].value_counts().to_dict() if len(closed) and "exit_reason" in closed.columns else {}
    summary = {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "initial_equity": initial_equity,
        "final_equity": float(curve.iloc[-1]["equity_usd"]) if len(curve) else initial_equity,
        "total_return_pct": float(curve.iloc[-1]["return_pct"]) if len(curve) else 0.0,
        "closed_trades": len(closed),
        "win_rate_pct": float(win),
        "max_drawdown_pct": _max_drawdown(curve["equity_usd"]) if len(curve) else 0.0,
        "universe_symbols": len(symbols),
        "symbols_with_radar": len(radar),
        "exit_reasons": exit_mix,
    }
    return BacktestResult(equity_curve=curve, trades=closed, summary=summary)


def _max_drawdown(equity: pd.Series) -> float:
    peak = equity.cummax()
    dd = (equity / peak - 1) * 100
    return float(dd.min()) if len(dd) else 0.0


def _benchmark_return(ticker: str, start: date, end: date) -> float:
    hist = yf.Ticker(ticker).history(start=start.isoformat(), end=end.isoformat(), auto_adjust=True)
    if hist.empty or len(hist) < 2:
        return float("nan")
    return (float(hist["Close"].iloc[-1]) / float(hist["Close"].iloc[0]) - 1) * 100


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    p = argparse.ArgumentParser()
    p.add_argument("--start", default="2026-01-01")
    p.add_argument("--end", default=date.today().isoformat())
    args = p.parse_args()
    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)

    res = run_loop_backtest(start, end)
    s = res.summary
    spy = _benchmark_return("SPY", start, end)
    qqq = _benchmark_return("QQQ", start, end)

    print("\n=== LOOP backtest (S&P 500 + Nasdaq-100, ex-pharma) ===")
    print(f"Window: {s['start']} → {s['end']}")
    print(f"Universe: {s['universe_symbols']} names ({s['symbols_with_radar']} with radar history)")
    print(f"Final equity: ${s['final_equity']:,.2f}  ({s['total_return_pct']:+.2f}%)")
    print(f"Max drawdown: {s['max_drawdown_pct']:.2f}%")
    print(f"Closed trades: {s['closed_trades']}  Win rate: {s['win_rate_pct']:.1f}%")
    if s.get("exit_reasons"):
        print(f"Exit mix: {s['exit_reasons']}")
    print(f"Benchmarks: SPY {spy:+.2f}%  QQQ {qqq:+.2f}%")


if __name__ == "__main__":
    main()
