"""Listed option chains via yfinance — free, no API key.

Pulls every near-term expiry for a ticker, concatenates calls/puts, and
inverts Black-Scholes IV from listed last (or bid/ask mid). Yahoo's
`impliedVolatility` column is a 1/32-style placeholder whenever the
session is closed (bid=ask=0), so we never use it as the map.

0DTE rows are skipped — those prints are from the prior session with
near-zero calendar time. Weekend-vol math lives in
`pipeline.compute.skew_map`.
"""
from __future__ import annotations

import logging
import math
import os
import time
from datetime import date, datetime, timezone
from typing import Any

import numpy as np
import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

DEFAULT_TICKERS = [
    "SPY", "QQQ", "IWM",
    "AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "META", "GOOGL",
]

MAX_EXPIRIES = 10
EXPIRY_DELAY = 0.35
TICKER_DELAY = 0.8
MIN_IV = 0.04
MAX_IV = 2.5
STALE_DAYS = 7
MIN_PRICE = 0.05  # skip sub-nickel last/mid (junk inversion)
RATE = 0.0        # BS rate; IV map is relative, not a funding model
SLICE_LO, SLICE_HI = 0.80, 1.20
MONEYNESS_BUCKETS = (0.80, 0.85, 0.90, 0.95, 0.975, 1.00, 1.025, 1.05, 1.10, 1.15, 1.20)
OTM_PCT = 0.10  # 10% OTM put/call as a 25-delta-style proxy


def skew_universe() -> list[str]:
    raw = os.getenv("SKEW_TICKERS", "")
    if raw.strip():
        return [s.strip().upper() for s in raw.split(",") if s.strip()]
    return list(DEFAULT_TICKERS)


def _spot(tk: yf.Ticker, symbol: str) -> float | None:
    try:
        fi = getattr(tk, "fast_info", None)
        if fi is not None:
            for key in ("lastPrice", "last_price", "regularMarketPrice"):
                val = fi.get(key) if hasattr(fi, "get") else getattr(fi, key, None)
                if val is not None and np.isfinite(float(val)) and float(val) > 0:
                    return float(val)
    except Exception:
        logger.debug("%s: fast_info spot failed", symbol, exc_info=True)
    try:
        hist = tk.history(period="5d")
        if hist is not None and not hist.empty:
            close = hist["Close"].dropna()
            if not close.empty:
                return float(close.iloc[-1])
    except Exception:
        logger.exception("%s: history spot failed", symbol)
    return None


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def bs_price(spot: float, strike: float, t_years: float, sig: float, cp: str, rate: float = RATE) -> float:
    if t_years <= 0 or sig <= 0 or spot <= 0 or strike <= 0:
        return max(spot - strike, 0.0) if cp == "C" else max(strike - spot, 0.0)
    vsT = sig * math.sqrt(t_years)
    d1 = (math.log(spot / strike) + (rate + 0.5 * sig * sig) * t_years) / vsT
    d2 = d1 - vsT
    df = math.exp(-rate * t_years)
    if cp == "C":
        return spot * _norm_cdf(d1) - strike * df * _norm_cdf(d2)
    return strike * df * _norm_cdf(-d2) - spot * _norm_cdf(-d1)


def implied_vol(price: float, spot: float, strike: float, t_years: float, cp: str) -> float | None:
    """Bisection IV from a listed last or mid. None if no time value / no bracket."""
    if price is None or not np.isfinite(price) or price < MIN_PRICE:
        return None
    if t_years <= 0 or spot <= 0 or strike <= 0:
        return None
    intrinsic = max(spot - strike, 0.0) if cp == "C" else max(strike - spot, 0.0)
    if price <= intrinsic + 0.01:
        return None
    lo, hi = 1e-4, 5.0
    p_lo = bs_price(spot, strike, t_years, lo, cp)
    p_hi = bs_price(spot, strike, t_years, hi, cp)
    if not (p_lo <= price <= p_hi):
        return None
    for _ in range(48):
        mid = 0.5 * (lo + hi)
        px = bs_price(spot, strike, t_years, mid, cp)
        if px > price:
            hi = mid
        else:
            lo = mid
    sig = 0.5 * (lo + hi)
    if sig < MIN_IV or sig > MAX_IV:
        return None
    return sig


def _mark_price(bid: float, ask: float, last: float) -> float | None:
    if np.isfinite(bid) and np.isfinite(ask) and bid > 0 and ask > bid:
        return 0.5 * (bid + ask)
    if np.isfinite(last) and last >= MIN_PRICE:
        return float(last)
    return None


def _t_years(exp_d: date, last_trade) -> float:
    """Calendar time used to invert the print — last-trade date vs expiry, not today.

    Premarket / weekend snapshots still have Thursday lasts; using *today* as T
    would inflate 0DTE IV. Floor at a quarter-session so T is never zero.
    """
    if last_trade is None or (isinstance(last_trade, float) and np.isnan(last_trade)) or pd.isna(last_trade):
        days = (exp_d - date.today()).days
    else:
        try:
            ltd = pd.Timestamp(last_trade).date()
            days = (exp_d - ltd).days
        except Exception:
            days = (exp_d - date.today()).days
    return max(float(days), 0.25) / 365.0


def _clean_side(df: pd.DataFrame, option_type: str, today: date, spot: float, exp_d: date) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    out = df.copy()
    out["optionType"] = option_type
    out["strike"] = pd.to_numeric(out.get("strike"), errors="coerce")
    out["volume"] = pd.to_numeric(out.get("volume"), errors="coerce").fillna(0)
    out["openInterest"] = pd.to_numeric(out.get("openInterest"), errors="coerce").fillna(0)
    out["bid"] = pd.to_numeric(out.get("bid"), errors="coerce")
    out["ask"] = pd.to_numeric(out.get("ask"), errors="coerce")
    out["lastPrice"] = pd.to_numeric(out.get("lastPrice"), errors="coerce")
    out["yfIv"] = pd.to_numeric(out.get("impliedVolatility"), errors="coerce")
    if "lastTradeDate" in out.columns:
        ltd = pd.to_datetime(out["lastTradeDate"], utc=True, errors="coerce")
        cutoff = pd.Timestamp(today, tz="UTC") - pd.Timedelta(days=STALE_DAYS)
        stale = ltd.notna() & (ltd < cutoff)
        dead = (out["volume"] <= 0) & (out["openInterest"] <= 0)
        out = out[~(stale & dead)].copy()
        out["lastTradeDate"] = ltd.loc[out.index]
    else:
        out["lastTradeDate"] = pd.NaT

    out = out[out["strike"].notna() & (out["strike"] > 0)]
    ivs: list[float | None] = []
    for row in out.itertuples(index=False):
        mark = _mark_price(float(row.bid) if row.bid is not None else float("nan"),
                           float(row.ask) if row.ask is not None else float("nan"),
                           float(row.lastPrice) if row.lastPrice is not None else float("nan"))
        t_y = _t_years(exp_d, getattr(row, "lastTradeDate", None))
        iv = implied_vol(mark, spot, float(row.strike), t_y, option_type) if mark is not None else None
        ivs.append(iv)
    out["impliedVolatility"] = ivs
    out = out[out["impliedVolatility"].notna()].reset_index(drop=True)
    return out


def _interp_iv(df: pd.DataFrame, target: float) -> float | None:
    if df is None or df.empty:
        return None
    sub = df[["strike", "impliedVolatility"]].dropna().sort_values("strike")
    if sub.empty:
        return None
    strikes = sub["strike"].to_numpy(dtype=float)
    ivs = sub["impliedVolatility"].to_numpy(dtype=float)
    if target <= strikes[0]:
        return float(ivs[0])
    if target >= strikes[-1]:
        return float(ivs[-1])
    return float(np.interp(target, strikes, ivs))


def _atm_iv(calls: pd.DataFrame, puts: pd.DataFrame, spot: float) -> float | None:
    c = _interp_iv(calls, spot)
    p = _interp_iv(puts, spot)
    vals = [v for v in (c, p) if v is not None]
    if not vals:
        return None
    return float(sum(vals) / len(vals))


def _otm_iv(side: pd.DataFrame, target: float) -> float | None:
    return _interp_iv(side, target)


def _slice_rows(calls: pd.DataFrame, puts: pd.DataFrame, spot: float) -> list[dict[str, Any]]:
    lo, hi = spot * SLICE_LO, spot * SLICE_HI
    strikes = sorted(set(
        float(s) for s in pd.concat([calls["strike"], puts["strike"]], ignore_index=True)
        if lo <= float(s) <= hi
    ))
    rows: list[dict[str, Any]] = []
    for k in strikes:
        c = calls.loc[calls["strike"] == k]
        p = puts.loc[puts["strike"] == k]
        iv_c = float(c["impliedVolatility"].iloc[0]) if not c.empty else None
        iv_p = float(p["impliedVolatility"].iloc[0]) if not p.empty else None
        # What traders pay: OTM put below spot, OTM call above, average at ATM.
        if k < spot * 0.995:
            iv = iv_p if iv_p is not None else iv_c
        elif k > spot * 1.005:
            iv = iv_c if iv_c is not None else iv_p
        else:
            vals = [v for v in (iv_c, iv_p) if v is not None]
            iv = float(sum(vals) / len(vals)) if vals else None
        if iv is None:
            continue
        oi = 0.0
        vol = 0.0
        if not c.empty:
            oi += float(c["openInterest"].iloc[0] or 0)
            vol += float(c["volume"].iloc[0] or 0)
        if not p.empty:
            oi += float(p["openInterest"].iloc[0] or 0)
            vol += float(p["volume"].iloc[0] or 0)
        rows.append({
            "k": round(k, 4),
            "kPct": round(k / spot * 100, 2),
            "iv": round(iv, 6),
            "ivCall": None if iv_c is None else round(iv_c, 6),
            "ivPut": None if iv_p is None else round(iv_p, 6),
            "oi": int(oi),
            "volume": int(vol),
        })
    return rows


def _surface_cell(calls: pd.DataFrame, puts: pd.DataFrame, spot: float, m: float) -> float | None:
    target = spot * m
    if m < 0.995:
        return _interp_iv(puts, target)
    if m > 1.005:
        return _interp_iv(calls, target)
    return _atm_iv(calls, puts, spot)


def fetch_symbol(symbol: str, today: date | None = None) -> dict[str, Any] | None:
    """Return a processed chain payload for one ticker, or None on failure."""
    today = today or date.today()
    tk = yf.Ticker(symbol)
    spot = _spot(tk, symbol)
    if spot is None:
        logger.warning("%s: no spot price", symbol)
        return None
    try:
        expiries = list(tk.options or [])
    except Exception:
        logger.exception("%s: failed to list expiries", symbol)
        return None
    if not expiries:
        logger.warning("%s: no listed expiries", symbol)
        return None

    slices: list[dict[str, Any]] = []
    term: list[dict[str, Any]] = []
    surface: list[dict[str, Any]] = []

    for i, exp in enumerate(expiries[:MAX_EXPIRIES]):
        try:
            chain = tk.option_chain(exp)
        except Exception:
            logger.exception("%s: option_chain(%s) failed", symbol, exp)
            continue
        try:
            exp_d = date.fromisoformat(exp)
        except ValueError:
            continue
        dte = (exp_d - today).days
        if dte < 1:
            continue
        calls = _clean_side(chain.calls, "C", today, spot, exp_d)
        puts = _clean_side(chain.puts, "P", today, spot, exp_d)
        if calls.empty and puts.empty:
            continue

        atm = _atm_iv(calls, puts, spot)
        put_iv = _otm_iv(puts, spot * (1 - OTM_PCT))
        call_iv = _otm_iv(calls, spot * (1 + OTM_PCT))
        rr = (put_iv - call_iv) if put_iv is not None and call_iv is not None else None
        fly = None
        if atm is not None and put_iv is not None and call_iv is not None:
            fly = (put_iv + call_iv) / 2 - atm

        slice_rows = _slice_rows(calls, puts, spot)
        slices.append({
            "expiry": exp,
            "dte": dte,
            "weekday": exp_d.weekday(),
            "atmIv": None if atm is None else round(atm, 6),
            "putIv": None if put_iv is None else round(put_iv, 6),
            "callIv": None if call_iv is None else round(call_iv, 6),
            "rr": None if rr is None else round(rr, 6),
            "fly": None if fly is None else round(fly, 6),
            "strikes": slice_rows,
        })
        term.append({
            "expiry": exp,
            "dte": dte,
            "weekday": exp_d.weekday(),
            "atmIv": None if atm is None else round(atm, 6),
            "putIv": None if put_iv is None else round(put_iv, 6),
            "callIv": None if call_iv is None else round(call_iv, 6),
        })
        for m in MONEYNESS_BUCKETS:
            iv = _surface_cell(calls, puts, spot, m)
            if iv is None:
                continue
            surface.append({
                "expiry": exp,
                "dte": dte,
                "kPct": round(m * 100, 1),
                "iv": round(iv, 6),
            })
        if i < MAX_EXPIRIES - 1:
            time.sleep(EXPIRY_DELAY)

    if not term:
        logger.warning("%s: no usable expiries after filters", symbol)
        return None

    return {
        "symbol": symbol,
        "spot": round(spot, 4),
        "asof": today.isoformat(),
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "slices": slices,
        "term": term,
        "surface": surface,
    }
