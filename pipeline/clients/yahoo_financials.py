"""Yahoo Finance annual statements via yfinance (F-Score fallback, no API key)."""
from __future__ import annotations

import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any

import pandas as pd

from pipeline.clients.cash_eod import yahoo_ticker

logger = logging.getLogger(__name__)

DEFAULT_WORKERS = int(os.getenv("FINANCIALS_YAHOO_WORKERS", "6"))
DEFAULT_PER_SYMBOL_DELAY = float(os.getenv("FINANCIALS_YAHOO_DELAY_SEC", "0.15"))
MAX_FY = 3

INCOME_MAP = {
    "Total Revenue": "revenue",
    "Net Income": "netIncome",
    "Gross Profit": "grossProfit",
    "Diluted Average Shares": "weightedAverageShsOutDil",
    "Basic Average Shares": "weightedAverageShsOut",
}

BALANCE_MAP = {
    "Total Assets": "totalAssets",
    "Long Term Debt": "longTermDebt",
    "Long Term Debt And Capital Lease Obligation": "longTermDebt",
    "Current Assets": "totalCurrentAssets",
    "Current Liabilities": "totalCurrentLiabilities",
}

CASHFLOW_MAP = {
    "Operating Cash Flow": "operatingCashFlow",
    "Cash Flow From Continuing Operating Activities": "operatingCashFlow",
}


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


def _column_date(col) -> str | None:
    try:
        return pd.Timestamp(col).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return None


def _frame_to_reports(
    symbol: str,
    report_type: str,
    df: pd.DataFrame | None,
    field_map: dict[str, str],
) -> list[dict]:
    if df is None or df.empty:
        return []
    rows: list[dict] = []
    cols = list(df.columns)[:MAX_FY]
    for col in cols:
        period_end = _column_date(col)
        if not period_end:
            continue
        data: dict[str, Any] = {"_source": "yahoo"}
        for yf_name, lse_name in field_map.items():
            if yf_name not in df.index:
                continue
            val = _finite(df.at[yf_name, col])
            if val is not None:
                data[lse_name] = val
        if len(data) <= 1:
            continue
        fy = period_end[:4]
        rows.append(
            {
                "symbol": symbol,
                "report_type": report_type,
                "date": period_end,
                "period": "FY",
                "fiscal_year": fy,
                "reported_currency": None,
                "cik": None,
                "filing_date": None,
                "data": data,
            }
        )
    return rows


def fetch_yahoo_financial_reports_for_symbol(
    symbol: str,
    *,
    sleep_after: float = DEFAULT_PER_SYMBOL_DELAY,
) -> list[dict]:
    try:
        import yfinance as yf
    except ImportError:
        logger.error("yfinance not installed")
        return []

    ticker_sym = yahoo_ticker(symbol)
    out: list[dict] = []
    try:
        t = yf.Ticker(ticker_sym)
        out.extend(_frame_to_reports(symbol, "income", t.income_stmt, INCOME_MAP))
        out.extend(_frame_to_reports(symbol, "balance", t.balance_sheet, BALANCE_MAP))
        out.extend(_frame_to_reports(symbol, "cashflow", t.cashflow, CASHFLOW_MAP))
    except Exception:
        logger.warning("Yahoo financials failed for %s", symbol, exc_info=True)
    if sleep_after > 0:
        time.sleep(sleep_after)
    return out


@dataclass
class YahooFinancialsBatchResult:
    rows: list[dict]
    symbols_ok: int
    symbols_failed: int


def fetch_yahoo_financials_batch(
    symbols: list[str],
    *,
    workers: int = DEFAULT_WORKERS,
    sleep_after: float = DEFAULT_PER_SYMBOL_DELAY,
) -> YahooFinancialsBatchResult:
    if not symbols:
        return YahooFinancialsBatchResult([], 0, 0)
    rows: list[dict] = []
    ok = 0
    fail = 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {
            pool.submit(fetch_yahoo_financial_reports_for_symbol, s, sleep_after=sleep_after): s
            for s in symbols
        }
        for fut in as_completed(futures):
            sym = futures[fut]
            try:
                got = fut.result()
                if got:
                    rows.extend(got)
                    ok += 1
                else:
                    fail += 1
            except Exception:
                logger.warning("Yahoo financials worker failed for %s", sym, exc_info=True)
                fail += 1
    return YahooFinancialsBatchResult(rows=rows, symbols_ok=ok, symbols_failed=fail)