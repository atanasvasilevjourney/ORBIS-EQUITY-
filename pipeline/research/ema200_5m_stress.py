"""5-minute EMA200 stress harness — data latency, bar coverage, Pine EMA parity.

Daily EMA200 scanner math lives in ``pipeline.ema200_scanner`` (EOD, adjusted OHLC).
This module validates what Yahoo 5m can support for intraday overlays and whether
``200 × 5m`` bars are the same idea as the daily retrace watchlist (they are not).

Usage (notebook or CLI smoke):
    PYTHONPATH=/workspace python -m pipeline.research.ema200_5m_stress --symbol SPY
"""
from __future__ import annotations

import argparse
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import requests

from pipeline.compute.atr_risk import compute_atr
from pipeline.ema200_scanner.config.loader import load_config
from pipeline.ema200_scanner.indicators.ema import apply_trust_window, ema_series
from pipeline.ema200_scanner.indicators.features import compute_features_frame
from pipeline.ema200_scanner.indicators.ribbon import ribbon_dist_atr
from pipeline.ema200_scanner.watchlist import classify_setup
from pipeline.research.ema200_backtest import download_ohlcv

NY = ZoneInfo("America/New_York")
YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
UA = "Mozilla/5.0 (compatible; OrbisEquity-5mStress/1.0)"
SESSION_CLOSE_MIN = 16 * 60


@dataclass(frozen=True)
class FetchLatency:
    symbol: str
    interval: str
    range_param: str
    fetch_ms: float
    n_bars: int
    first_ts: pd.Timestamp | None
    last_ts: pd.Timestamp | None
    last_bar_age_min: float | None
    duplicate_ts: int
    source: str


def _ny_minutes(ts: pd.Timestamp) -> int:
    t = ts.tz_convert(NY) if ts.tzinfo else ts.tz_localize("UTC").tz_convert(NY)
    return t.hour * 60 + t.minute


def fetch_yahoo_intraday(
    symbol: str,
    *,
    interval: str = "5m",
    range_param: str = "5d",
    timeout: float = 25.0,
) -> tuple[pd.DataFrame, FetchLatency]:
    """Yahoo chart API — same family as ``src/app/api/chart`` 5m path (unadjusted quote)."""
    t0 = time.perf_counter()
    url = YAHOO_CHART.format(ticker=symbol.upper())
    resp = requests.get(
        url,
        params={
            "interval": interval,
            "range": range_param,
            "includePrePost": "false",
            "events": "history",
        },
        headers={"User-Agent": UA},
        timeout=timeout,
    )
    resp.raise_for_status()
    payload = resp.json()
    result = ((payload.get("chart") or {}).get("result") or [None])[0]
    if not result:
        raise RuntimeError(f"empty chart for {symbol}")
    ts = result.get("timestamp") or []
    q = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    rows: list[dict[str, Any]] = []
    last_ts = -1
    dup = 0
    for i, t in enumerate(ts):
        if t <= last_ts:
            dup += 1
            continue
        last_ts = t
        o, h, l, c = (
            q.get("open", [None])[i] if i < len(q.get("open") or []) else None,
            q.get("high", [None])[i] if i < len(q.get("high") or []) else None,
            q.get("low", [None])[i] if i < len(q.get("low") or []) else None,
            q.get("close", [None])[i] if i < len(q.get("close") or []) else None,
        )
        if c is None:
            continue
        rows.append(
            {
                "ts": int(t),
                "open": float(o) if o is not None else float(c),
                "high": float(h) if h is not None else float(c),
                "low": float(l) if l is not None else float(c),
                "close": float(c),
                "volume": float(q.get("volume", [0])[i] or 0),
            }
        )
    df = pd.DataFrame(rows)
    if df.empty:
        lat = FetchLatency(symbol, interval, range_param, (time.perf_counter() - t0) * 1000, 0, None, None, None, dup, "yahoo")
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"]), lat

    df["datetime"] = pd.to_datetime(df["ts"], unit="s", utc=True).dt.tz_convert(NY)
    df = df.set_index("datetime").sort_index()
    df = df[["open", "high", "low", "close", "volume"]]
    now = datetime.now(timezone.utc)
    last_ts_dt = df.index[-1]
    age_min = (now - last_ts_dt.tz_convert(timezone.utc)).total_seconds() / 60.0
    lat = FetchLatency(
        symbol.upper(),
        interval,
        range_param,
        (time.perf_counter() - t0) * 1000,
        len(df),
        df.index[0],
        df.index[-1],
        age_min,
        dup,
        "yahoo",
    )
    return df, lat


def drop_incomplete_cash_bar(bars: pd.DataFrame, *, now: datetime | None = None) -> pd.DataFrame:
    """Drop today's last 5m bar before 16:00 ET if it is still the cash session."""
    if bars.empty:
        return bars
    now = now or datetime.now(NY)
    if now.tzinfo is None:
        now = now.replace(tzinfo=NY)
    else:
        now = now.astimezone(NY)
    last = bars.index[-1]
    if last.date() == now.date() and _ny_minutes(last) < SESSION_CLOSE_MIN:
        return bars.iloc[:-1].copy()
    return bars


def features_5m_native(
    ohlcv: pd.DataFrame,
    *,
    ema_period: int = 200,
    history_min_bars: int = 200,
) -> pd.DataFrame:
    """EMA200 on **5-minute closes** (200 bars ≈ ~2.6 RTH days), plus ribbon on high."""
    cfg = load_config()
    atr_period = int(cfg["atr_period"])
    slope_lb = int(cfg["trend"]["slope_lookback"])
    return compute_features_frame(
        ohlcv,
        ema_period=ema_period,
        atr_period=atr_period,
        history_min_bars=history_min_bars,
        slope_lookback=slope_lb,
        regime=None,
    )


def attach_daily_ema200_step(
    bars_5m: pd.DataFrame,
    daily_adj: pd.DataFrame,
    *,
    ema_period: int = 200,
    history_min: int = 200,
) -> pd.DataFrame:
    """Forward-fill **daily** EMA200 onto each 5m bar (chart-style anchor, not 200×5m)."""
    daily = daily_adj.sort_index().copy()
    close_d = daily["close"].astype(float)
    ema_d = apply_trust_window(ema_series(close_d, ema_period), history_min_bars=history_min)
    ema_hi_d = apply_trust_window(
        ema_series(daily["high"].astype(float), ema_period), history_min_bars=history_min
    )
    ema_map = {idx.date(): val for idx, val in zip(daily.index, ema_d.values) if pd.notna(val)}
    ema_hi_map = {idx.date(): val for idx, val in zip(daily.index, ema_hi_d.values) if pd.notna(val)}
    out = bars_5m.copy()
    out["ema200_daily"] = [ema_map.get(ts.date()) for ts in out.index]
    out["ema200_high_daily"] = [ema_hi_map.get(ts.date()) for ts in out.index]
    atr = compute_atr(out, period=int(load_config()["atr_period"]))
    out["ribbon_dist_atr_daily"] = ribbon_dist_atr(
        out["close"],
        out["ema200_daily"],
        out["ema200_high_daily"],
        atr,
    )
    return out


def classify_latest_row(feat_row: pd.Series, cfg: dict | None = None) -> str | None:
    cfg = cfg or load_config()
    payload = feat_row.to_dict()
    payload["symbol"] = payload.get("symbol", "X")
    return classify_setup(payload, cfg=cfg)


def stress_symbol(
    symbol: str,
    *,
    interval: str = "5m",
    range_param: str = "5d",
) -> dict[str, Any]:
    """One-symbol report: latency, coverage, native 5m vs daily-step ribbon."""
    bars, lat = fetch_yahoo_intraday(symbol, interval=interval, range_param=range_param)
    bars = drop_incomplete_cash_bar(bars)
    cfg = load_config()
    ema_p = int(cfg["ema_period"])
    hist_min = int(cfg["history_min_bars"])

    native_ok = len(bars) >= hist_min
    native_feat = features_5m_native(bars) if native_ok else pd.DataFrame()
    native_last = native_feat.iloc[-1] if not native_feat.empty else None
    native_setup = classify_latest_row(native_last, cfg) if native_last is not None else None

    daily = download_ohlcv(symbol, "2023-01-01")

    merged = attach_daily_ema200_step(bars, daily, ema_period=ema_p, history_min=hist_min)
    last = merged.iloc[-1] if not merged.empty else None
    daily_dist = float(last["ribbon_dist_atr_daily"]) if last is not None and pd.notna(last.get("ribbon_dist_atr_daily")) else None

    rth_bars = merged.between_time("09:30", "16:00") if not merged.empty else merged
    return {
        "symbol": symbol.upper(),
        "latency": lat,
        "n_bars_total": len(bars),
        "n_bars_rth": len(rth_bars),
        "native_5m_ema200_ready": native_ok,
        "native_ribbon_dist_atr": float(native_last["ribbon_dist_atr"]) if native_last is not None else None,
        "native_setup": native_setup,
        "daily_step_ribbon_dist_atr": daily_dist,
        "last_close": float(last["close"]) if last is not None else None,
        "notes": (
            "Native 5m EMA200 uses 200 five-minute bars (~2–3 sessions). "
            "daily_step_* is the same strategy as /ema200 (daily adjusted ribbon)."
        ),
    }


def stress_batch(symbols: list[str]) -> pd.DataFrame:
    rows = []
    for sym in symbols:
        try:
            rep = stress_symbol(sym)
            lat: FetchLatency = rep["latency"]
            rows.append(
                {
                    "symbol": sym,
                    "fetch_ms": round(lat.fetch_ms, 1),
                    "bars": lat.n_bars,
                    "last_age_min": round(lat.last_bar_age_min or 0, 1),
                    "native_ready": rep["native_5m_ema200_ready"],
                    "native_ribbon_atr": rep["native_ribbon_dist_atr"],
                    "daily_ribbon_atr": rep["daily_step_ribbon_dist_atr"],
                    "native_setup": rep["native_setup"],
                }
            )
        except Exception as exc:
            rows.append({"symbol": sym, "error": str(exc)})
    return pd.DataFrame(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="EMA200 5m stress smoke")
    parser.add_argument("--symbol", default="SPY")
    parser.add_argument("--batch", nargs="*", default=[])
    args = parser.parse_args()
    if args.batch:
        print(stress_batch(args.batch).to_string(index=False))
        return
    rep = stress_symbol(args.symbol)
    lat: FetchLatency = rep["latency"]
    print(f"{lat.symbol} {lat.interval} fetch={lat.fetch_ms:.0f}ms bars={lat.n_bars} age_min={lat.last_bar_age_min:.1f}")
    print(rep)


if __name__ == "__main__":
    main()
