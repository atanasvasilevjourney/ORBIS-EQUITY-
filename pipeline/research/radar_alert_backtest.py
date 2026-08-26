"""Backtest KovaView Trend Radar *alert* entries — trade journal style.

Entry alerts mirror what the terminal surfaces today:
  - GREEN_FLIP  — state flips into GREEN (scoreboard FLIP badge)
  - BREAKOUT_ALERT — GREEN + breakout_active + volume_confirmed

Exits when state leaves GREEN. Fills at next-bar open (no lookahead).

Usage:
  PYTHONPATH=/workspace python -m pipeline.research.radar_alert_backtest
  PYTHONPATH=/workspace python -m pipeline.research.radar_alert_backtest \\
      --tickers SPY,AAPL,MSFT,JPM --start 2020-01-01 --max-trades 12
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from pipeline.compute.kama_regime import (
    KAMA_LONG_FAST,
    KAMA_LONG_N,
    KAMA_LONG_SLOW,
    calculate_kama,
)
from pipeline.compute.trend_radar import (
    ATR_COMPRESSION_RATIO,
    ATR_WINDOW,
    BEAR_THRESHOLD,
    BULL_THRESHOLD,
    EWMAC_FAST,
    EWMAC_SLOW,
    MIN_HISTORY_DAYS,
    MOM_LOOKBACKS,
    VOL_WINDOW,
    VOLUME_CONFIRM_RATIO,
    compute_quality_rank,
    determine_state,
)


@dataclass(frozen=True)
class Trade:
    ticker: str
    alert: str
    entry_date: str
    exit_date: str
    entry_price: float
    exit_price: float
    bars_held: int
    return_pct: float
    entry_rank: int
    entry_convergence: int
    exit_reason: str


def download_ohlcv(ticker: str, start: str) -> pd.DataFrame:
    import yfinance as yf

    data = yf.download(ticker, start=start, progress=False, auto_adjust=True)
    if data.empty:
        raise RuntimeError(f"No data for {ticker}")
    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.get_level_values(0)
    df = data.rename(columns=str.lower)[["open", "high", "low", "close", "volume"]].copy()
    df = df.dropna()
    df["symbol"] = ticker
    return df


def _rolling_momentum_z(close: pd.Series) -> pd.Series:
    """Expanding-compatible daily momentum z (aligned with compute_momentum_z)."""
    out = pd.Series(0.0, index=close.index, dtype=float)
    rets = close.pct_change()
    min_len = max(MOM_LOOKBACKS) + VOL_WINDOW
    for i in range(min_len, len(close)):
        window = close.iloc[: i + 1]
        r_series = rets.iloc[: i + 1].dropna()
        zscores = []
        for lb in MOM_LOOKBACKS:
            if len(window) < lb + 1:
                continue
            ret = (window.iloc[-1] / window.iloc[-lb - 1]) - 1
            lb_vol = r_series.iloc[-lb:].std()
            if lb_vol and lb_vol > 0:
                zscores.append(float(np.clip(ret / (lb_vol * np.sqrt(lb)), -3, 3)))
        out.iloc[i] = float(np.mean(zscores)) if zscores else 0.0
    return out


def _ewmac_series(close: pd.Series) -> pd.Series:
    fast = close.ewm(span=EWMAC_FAST, min_periods=EWMAC_FAST).mean()
    slow = close.ewm(span=EWMAC_SLOW, min_periods=EWMAC_SLOW).mean()
    vol = close.pct_change().rolling(VOL_WINDOW).std()
    raw = (fast - slow) / (close * vol.replace(0, np.nan))
    return raw.clip(-3, 3).fillna(0.0)


def _z52_series(close: pd.Series) -> pd.Series:
    high_252 = close.rolling(252, min_periods=20).max()
    prox = (close / high_252) - 1.0
    return prox.clip(-1, 0).fillna(0.0)


def _breakout_series(close: pd.Series, high: pd.Series, low: pd.Series) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat(
        [(high - low), (high - prev_close).abs(), (low - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    atr_cur = tr.rolling(ATR_WINDOW).mean()
    atr_60 = tr.rolling(60).mean()
    compressed = (atr_cur / atr_60.replace(0, np.nan)) < ATR_COMPRESSION_RATIO
    high_20 = high.rolling(20).max()
    at_high = close >= high_20 * 0.98
    return (compressed & at_high).fillna(False)


def _volume_confirm_series(close: pd.Series, volume: pd.Series) -> pd.Series:
    avg = volume.shift(1).rolling(VOL_WINDOW).mean()
    up = close > close.shift(1)
    return ((volume > avg * VOLUME_CONFIRM_RATIO) & up).fillna(False)


def _kama_regime_series(close: pd.Series) -> pd.Series:
    kl = calculate_kama(close, n=KAMA_LONG_N, fast=KAMA_LONG_FAST, slow=KAMA_LONG_SLOW)
    # Match compute_kama_regime: use prior bar close vs prior bar kl
    prior = close.shift(1) > kl.shift(1)
    return prior.map({True: 1, False: -1}).fillna(0).astype(int)


def build_radar_history(ohlcv: pd.DataFrame) -> pd.DataFrame:
    """Daily Trend Radar fields for alert detection."""
    close = ohlcv["close"].astype(float)
    high = ohlcv["high"].astype(float)
    low = ohlcv["low"].astype(float)
    volume = ohlcv["volume"].astype(float)

    z_mom = _rolling_momentum_z(close)
    f_ewmac = _ewmac_series(close)
    z_52 = _z52_series(close)
    breakout = _breakout_series(close, high, low)
    vol_confirm = _volume_confirm_series(close, volume)
    kama_regime = _kama_regime_series(close)

    ranks = []
    states = []
    convs = []
    for i in range(len(close)):
        if i + 1 < MIN_HISTORY_DAYS:
            ranks.append(50)
            states.append(0)
            convs.append(0)
            continue
        kr = int(kama_regime.iloc[i])
        brk = bool(breakout.iloc[i])
        vol = bool(vol_confirm.iloc[i])
        rank = compute_quality_rank(
            float(z_mom.iloc[i]),
            float(f_ewmac.iloc[i]),
            float(z_52.iloc[i]),
            brk,
            vol,
            kr,
        )
        state = determine_state(
            float(z_mom.iloc[i]),
            float(f_ewmac.iloc[i]),
            float(z_52.iloc[i]),
            rank,
            kr,
        )
        flags = [
            float(z_mom.iloc[i]) > 0,
            float(f_ewmac.iloc[i]) > 0,
            float(z_52.iloc[i]) > -0.10,
            brk,
            vol,
            kr > 0,
        ]
        ranks.append(rank)
        states.append(state)
        convs.append(int(sum(flags)))

    hist = pd.DataFrame(
        {
            "open": ohlcv["open"].astype(float).values,
            "close": close.values,
            "z_mom": z_mom.values,
            "f_ewmac": f_ewmac.values,
            "z_52": z_52.values,
            "breakout_active": breakout.astype(bool).values,
            "volume_confirmed": vol_confirm.astype(bool).values,
            "kama_regime": kama_regime.values,
            "quality_rank": ranks,
            "state": states,
            "convergence": convs,
        },
        index=ohlcv.index,
    )
    hist["prev_state"] = hist["state"].shift(1)
    hist["green_flip"] = (hist["state"] == 1) & (hist["prev_state"] != 1)
    hist["breakout_alert"] = (
        (hist["state"] == 1)
        & hist["breakout_active"]
        & hist["volume_confirmed"]
    )
    # Alert fires on bar close; actionable next open
    hist["alert"] = np.where(
        hist["green_flip"] & hist["breakout_alert"],
        "GREEN_FLIP+BREAKOUT",
        np.where(
            hist["green_flip"],
            "GREEN_FLIP",
            np.where(hist["breakout_alert"] & ~hist["green_flip"], "BREAKOUT_ALERT", ""),
        ),
    )
    return hist


def simulate_trades(
    ticker: str,
    hist: pd.DataFrame,
    *,
    alert_types: set[str] | None = None,
    max_hold_bars: int = 60,
    min_rank: int = 0,
    min_convergence: int = 0,
    from_date: str | None = None,
    exit_mode: str = "left_green",
) -> list[Trade]:
    """Long-only: enter next open after alert; exit next open after signal.

    exit_mode:
      - left_green: exit when state != GREEN (default, matches FLIP off)
      - red_only: exit only when state == RED (hold through GREY)
    """
    allowed = alert_types or {
        "GREEN_FLIP",
        "GREEN_FLIP+BREAKOUT",
        "BREAKOUT_ALERT",
    }
    trades: list[Trade] = []
    i = 0
    n = len(hist)
    while i < n - 1:
        row = hist.iloc[i]
        alert = str(row["alert"])
        if alert not in allowed:
            i += 1
            continue
        if int(row["quality_rank"]) < min_rank or int(row["convergence"]) < min_convergence:
            i += 1
            continue
        entry_i = i + 1
        if entry_i >= n:
            break
        entry_date = hist.index[entry_i]
        if from_date is not None and str(pd.Timestamp(entry_date).date()) < from_date:
            i += 1
            continue
        entry_px = float(hist.iloc[entry_i]["open"])
        if not np.isfinite(entry_px) or entry_px <= 0:
            i += 1
            continue
        entry_rank = int(row["quality_rank"])
        entry_conv = int(row["convergence"])

        exit_i = None
        exit_reason = "end_of_data"
        for j in range(entry_i, n):
            held = j - entry_i
            st = int(hist.iloc[j]["state"])
            should_exit = False
            if exit_mode == "red_only":
                should_exit = st == -1 and j > entry_i
                reason = "hit_red"
            else:
                should_exit = st != 1 and j > entry_i
                reason = "left_green"
            if should_exit:
                exit_i = j + 1 if j + 1 < n else j
                exit_reason = reason
                break
            if held >= max_hold_bars:
                exit_i = j
                exit_reason = "max_hold"
                break
        if exit_i is None:
            exit_i = n - 1
        if exit_i <= entry_i:
            i = entry_i + 1
            continue

        exit_px = float(hist.iloc[exit_i]["open"])
        if exit_reason == "end_of_data":
            exit_px = float(hist.iloc[exit_i]["close"])
        ret = (exit_px / entry_px) - 1.0
        trades.append(
            Trade(
                ticker=ticker,
                alert=alert,
                entry_date=str(pd.Timestamp(entry_date).date()),
                exit_date=str(pd.Timestamp(hist.index[exit_i]).date()),
                entry_price=round(entry_px, 4),
                exit_price=round(exit_px, 4),
                bars_held=int(exit_i - entry_i),
                return_pct=round(ret * 100, 2),
                entry_rank=entry_rank,
                entry_convergence=entry_conv,
                exit_reason=exit_reason,
            )
        )
        i = exit_i + 1
    return trades


def summarize(trades: list[Trade]) -> dict:
    if not trades:
        return {
            "n_trades": 0,
            "win_rate": 0.0,
            "avg_return_pct": 0.0,
            "total_return_pct_sum": 0.0,
            "avg_bars_held": 0.0,
        }
    rets = [t.return_pct for t in trades]
    wins = sum(1 for r in rets if r > 0)
    return {
        "n_trades": len(trades),
        "win_rate": round(wins / len(trades), 3),
        "avg_return_pct": round(float(np.mean(rets)), 2),
        "median_return_pct": round(float(np.median(rets)), 2),
        "total_return_pct_sum": round(float(np.sum(rets)), 2),
        "avg_bars_held": round(float(np.mean([t.bars_held for t in trades])), 1),
        "best_trade_pct": round(max(rets), 2),
        "worst_trade_pct": round(min(rets), 2),
    }


def print_journal(trades: list[Trade], limit: int | None = None) -> None:
    show = trades if limit is None else trades[:limit]
    print("=" * 100)
    print("KOVA VIEW RADAR ALERT TRADE JOURNAL")
    print("=" * 100)
    print(
        f"{'#':>3} {'Ticker':<6} {'Alert':<20} {'Entry':<12} {'Exit':<12} "
        f"{'In':>8} {'Out':>8} {'Ret%':>7} {'Days':>4} {'Rank':>4} {'Conv':>4} {'Exit reason'}"
    )
    for i, t in enumerate(show, 1):
        print(
            f"{i:3d} {t.ticker:<6} {t.alert:<20} {t.entry_date:<12} {t.exit_date:<12} "
            f"{t.entry_price:8.2f} {t.exit_price:8.2f} {t.return_pct:7.2f} "
            f"{t.bars_held:4d} {t.entry_rank:4d} {t.entry_convergence:4d} {t.exit_reason}"
        )


def run(
    tickers: list[str],
    start: str,
    *,
    max_trades: int = 15,
    min_rank: int = 60,
    min_convergence: int = 4,
    from_date: str = "2023-01-01",
    exit_mode: str = "left_green",
    out_json: Path | None = None,
) -> list[Trade]:
    all_trades: list[Trade] = []
    for t in tickers:
        print(f"Building radar history for {t}...", flush=True)
        try:
            ohlcv = download_ohlcv(t, start)
            hist = build_radar_history(ohlcv)
            trades = simulate_trades(
                t,
                hist,
                min_rank=min_rank,
                min_convergence=min_convergence,
                from_date=from_date,
                exit_mode=exit_mode,
            )
            print(f"  {t}: {len(trades)} qualified alert trades (from {from_date})")
            all_trades.extend(trades)
        except Exception as exc:
            print(f"  SKIP {t}: {exc}")

    # Chronological journal: most recent max_trades in the window (current relevance)
    all_trades.sort(key=lambda tr: tr.entry_date)
    journal = all_trades[-max_trades:] if len(all_trades) > max_trades else all_trades
    print_journal(journal)
    summary = summarize(journal)
    print("\n" + "=" * 100)
    print(
        f"SUMMARY (most recent {len(journal)} trades | min_rank>={min_rank} "
        f"conv>={min_convergence} exit={exit_mode} from {from_date})"
    )
    print("=" * 100)
    for k, v in summary.items():
        print(f"  {k}: {v}")

    full = summarize(all_trades)
    print("\nFULL QUALIFIED SAMPLE (all matching alert trades)")
    for k, v in full.items():
        print(f"  {k}: {v}")

    if out_json is not None:
        out_json.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "filters": {
                "min_rank": min_rank,
                "min_convergence": min_convergence,
                "from_date": from_date,
                "exit_mode": exit_mode,
                "tickers": tickers,
            },
            "summary_shown": summary,
            "summary_full": full,
            "trades": [asdict(t) for t in journal],
            "all_trades": [asdict(t) for t in all_trades],
        }
        out_json.write_text(json.dumps(payload, indent=2))
        print(f"\nWrote {out_json}")
    return journal


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--tickers", default="SPY,AAPL,MSFT,JPM,XOM")
    p.add_argument("--start", default="2020-01-01")
    p.add_argument("--max-trades", type=int, default=12)
    p.add_argument("--min-rank", type=int, default=60)
    p.add_argument("--min-convergence", type=int, default=4)
    p.add_argument("--from-date", default="2023-01-01")
    p.add_argument(
        "--exit-mode",
        default="left_green",
        choices=["left_green", "red_only"],
        help="left_green=exit when not GREEN; red_only=hold through GREY until RED",
    )
    p.add_argument(
        "--out",
        default="pipeline/research/artifacts/radar_alert_trades.json",
    )
    args = p.parse_args(argv)
    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    run(
        tickers,
        args.start,
        max_trades=args.max_trades,
        min_rank=args.min_rank,
        min_convergence=args.min_convergence,
        from_date=args.from_date,
        exit_mode=args.exit_mode,
        out_json=Path(args.out),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
