"""Yahoo Finance earnings calendar via yfinance (no API key)."""
from __future__ import annotations

import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Callable

import pandas as pd

logger = logging.getLogger(__name__)

DEFAULT_WORKERS = int(os.getenv("EARNINGS_YAHOO_WORKERS", "8"))
DEFAULT_PER_SYMBOL_DELAY = float(os.getenv("EARNINGS_YAHOO_DELAY_SEC", "0.12"))
DEFAULT_DATES_LIMIT = int(os.getenv("EARNINGS_YAHOO_DATES_LIMIT", "12"))


def _finite(val) -> float | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    try:
        f = float(val)
        if pd.isna(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _event_date_iso(ts) -> str | None:
    try:
        return pd.Timestamp(ts).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return None


def earnings_dates_to_rows(symbol: str, df: pd.DataFrame | None) -> list[dict]:
    if df is None or df.empty:
        return []
    rows: list[dict] = []
    for idx, row in df.iterrows():
        event_date = _event_date_iso(idx)
        if not event_date:
            continue
        eps_est = _finite(row.get("EPS Estimate"))
        eps_actual = _finite(row.get("Reported EPS"))
        surprise = _finite(row.get("Surprise(%)"))
        if surprise is None and eps_est is not None and eps_actual is not None and eps_est != 0:
            surprise = round(((eps_actual - eps_est) / abs(eps_est)) * 100, 2)
        rows.append(
            {
                "ticker": symbol,
                "event_date": event_date,
                "confirmed": eps_actual is not None,
                "source": "yahoo",
                "eps_est": eps_est,
                "eps_actual": eps_actual,
                "surprise_pct": surprise,
                "revenue_est": None,
                "revenue_actual": None,
            }
        )
    return rows


def fetch_yahoo_earnings_for_symbol(
    symbol: str,
    *,
    dates_limit: int = DEFAULT_DATES_LIMIT,
    sleep_after: float = DEFAULT_PER_SYMBOL_DELAY,
) -> list[dict]:
    try:
        import yfinance as yf
    except ImportError:
        logger.error("yfinance not installed")
        return []

    try:
        ticker = yf.Ticker(symbol)
        df = ticker.get_earnings_dates(limit=dates_limit)
        rows = earnings_dates_to_rows(symbol, df)
        if sleep_after > 0:
            time.sleep(sleep_after)
        return rows
    except Exception:
        logger.warning("Yahoo earnings failed for %s", symbol, exc_info=True)
        if sleep_after > 0:
            time.sleep(sleep_after)
        return []


@dataclass
class YahooEarningsBatchResult:
    rows: list[dict]
    symbols_ok: int
    symbols_failed: int


def fetch_yahoo_earnings_batch(
    symbols: list[str],
    *,
    workers: int = DEFAULT_WORKERS,
    dates_limit: int = DEFAULT_DATES_LIMIT,
    on_progress: Callable[[int, int], None] | None = None,
) -> YahooEarningsBatchResult:
    if not symbols:
        return YahooEarningsBatchResult(rows=[], symbols_ok=0, symbols_failed=0)

    workers = max(1, min(workers, 16))
    rows: list[dict] = []
    ok = 0
    failed = 0
    total = len(symbols)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(
                fetch_yahoo_earnings_for_symbol,
                sym,
                dates_limit=dates_limit,
            ): sym
            for sym in symbols
        }
        for i, fut in enumerate(as_completed(futures), start=1):
            sym = futures[fut]
            try:
                sym_rows = fut.result()
                if sym_rows:
                    ok += 1
                    rows.extend(sym_rows)
                else:
                    failed += 1
            except Exception:
                failed += 1
                logger.warning("Yahoo earnings worker failed for %s", sym, exc_info=True)
            if on_progress:
                on_progress(i, total)

    logger.info(
        "Yahoo earnings batch: %d symbols, %d with data, %d empty/fail, %d rows",
        total,
        ok,
        failed,
        len(rows),
    )
    return YahooEarningsBatchResult(rows=rows, symbols_ok=ok, symbols_failed=failed)