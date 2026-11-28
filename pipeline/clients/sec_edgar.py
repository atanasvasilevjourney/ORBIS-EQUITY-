"""SEC EDGAR XBRL companyfacts (free, no API key).

Docs: https://www.sec.gov/edgar/sec-api-documentation
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

from pipeline.clients.sec_xbrl_map import (
    BALANCE_FIELDS,
    CASHFLOW_FIELDS,
    INCOME_FIELDS,
    build_field_dict,
    list_fy_period_ends,
    score_f_score_readiness,
)

logger = logging.getLogger(__name__)

SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
DEFAULT_USER_AGENT = "ORBIS-Equity research contact@orbis-equity.invalid"
CACHE_SUBDIR = "sec-edgar"
TICKERS_CACHE_NAME = "company_tickers.json"
MAX_REQUESTS_PER_SEC = float(os.getenv("SEC_MAX_REQUESTS_PER_SEC", "10"))


class RateLimiter:
    def __init__(self, max_per_sec: float) -> None:
        self._interval = 1.0 / max(0.1, max_per_sec)
        self._lock = threading.Lock()
        self._last = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            delay = self._interval - (now - self._last)
            if delay > 0:
                time.sleep(delay)
            self._last = time.monotonic()


_rate_limiter = RateLimiter(MAX_REQUESTS_PER_SEC)


def sec_user_agent() -> str:
    return os.getenv("SEC_USER_AGENT", DEFAULT_USER_AGENT).strip() or DEFAULT_USER_AGENT


def _cache_dir() -> Path:
    base = os.getenv("SEC_CACHE_DIR") or os.path.join(
        os.path.expanduser("~"), ".cache", "orbis-equity"
    )
    path = Path(base) / CACHE_SUBDIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": sec_user_agent(),
            "Accept-Encoding": "gzip, deflate",
            "Accept": "application/json",
        }
    )
    return s


def _get_json(url: str, *, session: requests.Session | None = None) -> Any:
    session = session or _session()
    _rate_limiter.wait()
    resp = session.get(url, timeout=60)
    resp.raise_for_status()
    return resp.json()


def load_company_tickers(*, refresh_hours: int = 24) -> dict[str, int]:
    """Ticker -> CIK (int). Caches ``company_tickers.json`` on disk."""
    cache_path = _cache_dir() / TICKERS_CACHE_NAME
    if cache_path.is_file():
        age_h = (time.time() - cache_path.stat().st_mtime) / 3600
        if age_h < refresh_hours:
            with cache_path.open(encoding="utf-8") as f:
                raw = json.load(f)
            return _parse_ticker_index(raw)

    raw = _get_json(SEC_TICKERS_URL)
    with cache_path.open("w", encoding="utf-8") as f:
        json.dump(raw, f)
    return _parse_ticker_index(raw)


def _parse_ticker_index(raw: dict) -> dict[str, int]:
    out: dict[str, int] = {}
    for _idx, row in raw.items():
        ticker = str(row.get("ticker", "")).upper().strip()
        cik = row.get("cik_str") or row.get("cik")
        if ticker and cik is not None:
            out[ticker] = int(cik)
            out[ticker.replace(".", "-")] = int(cik)
    return out


def resolve_cik(symbol: str, ticker_index: dict[str, int]) -> int | None:
    sym = symbol.upper().strip()
    for cand in (sym, sym.replace(".", "-"), sym.replace("-", ".")):
        if cand in ticker_index:
            return ticker_index[cand]
    return None


def fetch_companyfacts(cik: int, *, session: requests.Session | None = None) -> dict:
    url = SEC_FACTS_URL.format(cik=f"{int(cik):010d}")
    return _get_json(url, session=session)


def companyfacts_to_report_rows(
    symbol: str,
    facts: dict,
    *,
    cik: int | None = None,
    max_fy: int = 3,
) -> list[dict]:
    us_gaap = (facts.get("facts") or {}).get("us-gaap") or {}
    if not us_gaap:
        return []
    entity_cik = cik or facts.get("cik")
    periods = list_fy_period_ends(us_gaap, max_periods=max_fy)
    rows: list[dict] = []
    for per in periods:
        end = per["end"]
        income = build_field_dict(us_gaap, INCOME_FIELDS, end=end)
        balance = build_field_dict(us_gaap, BALANCE_FIELDS, end=end)
        cashflow = build_field_dict(us_gaap, CASHFLOW_FIELDS, end=end)
        fy = per.get("fy")
        fiscal_year = str(fy) if fy is not None else end[:4]
        filed = per.get("filed")
        base = {
            "symbol": symbol,
            "period": "FY",
            "date": end,
            "fiscal_year": fiscal_year,
            "reported_currency": "USD",
            "cik": str(entity_cik).zfill(10) if entity_cik is not None else None,
            "filing_date": filed[:10] if filed else None,
        }
        for report_type, data in (
            ("income", income),
            ("balance", balance),
            ("cashflow", cashflow),
        ):
            if len(data) <= 1:
                continue
            rows.append({**base, "report_type": report_type, "data": data})
    return rows


@dataclass
class SecFinancialsBatchResult:
    rows: list[dict]
    symbols_ok: int
    symbols_no_cik: int
    symbols_failed: int
    symbols_partial: int
    coverage_full: int
    coverage_partial: int
    missing_field_counts: dict[str, int]


def _classify_symbol_rows(rows: list[dict]) -> tuple[bool, list[str]]:
    by_type: dict[str, dict] = {}
    for r in rows:
        if r.get("report_type") in ("income", "balance", "cashflow"):
            by_type[r["report_type"]] = r.get("data") or {}
    present, missing = score_f_score_readiness(
        by_type.get("income"),
        by_type.get("balance"),
        by_type.get("cashflow"),
    )
    full = present >= 9
    return full, missing


def fetch_sec_financials_batch(
    symbols: list[str],
    *,
    max_fy: int = 3,
    ticker_index: dict[str, int] | None = None,
) -> SecFinancialsBatchResult:
    if not symbols:
        return SecFinancialsBatchResult([], 0, 0, 0, 0, 0, 0, {})

    index = ticker_index or load_company_tickers()
    session = _session()
    all_rows: list[dict] = []
    ok = no_cik = failed = partial = full_cov = 0
    missing_counts: dict[str, int] = {}

    for symbol in symbols:
        cik = resolve_cik(symbol, index)
        if cik is None:
            no_cik += 1
            continue
        try:
            facts = fetch_companyfacts(cik, session=session)
            rows = companyfacts_to_report_rows(symbol, facts, cik=cik, max_fy=max_fy)
            if not rows:
                failed += 1
                continue
            sym_rows = [r for r in rows if r["symbol"] == symbol]
            is_full, missing = _classify_symbol_rows(sym_rows)
            if is_full:
                full_cov += 1
                ok += 1
            else:
                partial += 1
                ok += 1
                for m in missing:
                    missing_counts[m] = missing_counts.get(m, 0) + 1
            all_rows.extend(rows)
        except Exception:
            logger.warning("SEC companyfacts failed for %s (CIK %s)", symbol, cik, exc_info=True)
            failed += 1

    return SecFinancialsBatchResult(
        rows=all_rows,
        symbols_ok=ok,
        symbols_no_cik=no_cik,
        symbols_failed=failed,
        symbols_partial=partial,
        coverage_full=full_cov,
        coverage_partial=partial,
        missing_field_counts=missing_counts,
    )


def load_companyfacts_fixture(path: str | Path) -> dict:
    with Path(path).open(encoding="utf-8") as f:
        return json.load(f)