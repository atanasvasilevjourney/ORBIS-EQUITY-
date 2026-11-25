"""Financial reports ingest: LSE primary, Yahoo fallback → Supabase.

Fetches income statements, balance sheets, cash flows for universe members.
Stores in ``financial_reports`` with source noted in the JSON ``data`` blob.

Usage:
    python -m pipeline.ingest.financial_reports
"""
from __future__ import annotations

import logging
import sys
from collections import defaultdict
from dataclasses import dataclass

from dotenv import load_dotenv
from supabase import Client, create_client

from pipeline.clients.lse_api import LSEClient
from pipeline.clients.yahoo_financials import fetch_yahoo_financials_batch
from pipeline.config.settings import FINANCIAL_REPORT_TYPES, LSEConfig, SupabaseConfig
from pipeline.utils.ci_log import append_step_summary_json, gh_error, gh_warning
from pipeline.utils.supabase import fetch_active_symbols

load_dotenv()

logger = logging.getLogger(__name__)

REPORT_TYPES = FINANCIAL_REPORT_TYPES
BATCH_SIZE = 200


@dataclass
class FinancialReportsIngestResult:
    lse_ok: bool
    lse_rows: int
    yahoo_symbols: int
    yahoo_rows: int
    merged_rows: int
    upserted: int
    lse_error: str | None = None
    income_coverage: float | None = None


def _get_supabase_client() -> Client:
    cfg = SupabaseConfig()
    if not cfg.url or not cfg.service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in environment")
    return create_client(cfg.url, cfg.service_key)


def _ingest_reports_for_type(
    lse: LSEClient, symbols: list[str], report_type: str
) -> tuple[int, list[dict]]:
    """Fetch and upsert all reports of a given type (paginated). Returns (upserted, rows)."""
    logger.info("Fetching %s reports from LSE API...", report_type)

    universe_set = set(symbols)
    rows: list[dict] = []
    offset = 0
    page_size = LSEConfig().max_rows_per_request

    while True:
        try:
            raw_reports = lse.get_financial_reports(
                report_type=report_type,
                period="FY",
                limit=page_size,
                offset=offset,
            )
        except Exception:
            logger.exception("Failed to fetch %s reports at offset %d", report_type, offset)
            raise

        if not raw_reports:
            break

        for report in raw_reports:
            symbol = report.get("symbol")
            if not symbol or symbol not in universe_set:
                continue

            data_blob = report.get("data", {}) or {}
            if not data_blob:
                continue
            if isinstance(data_blob, dict):
                data_blob = {**data_blob, "_source": "lse"}

            rows.append(
                {
                    "symbol": symbol,
                    "report_type": report_type,
                    "date": report.get("date"),
                    "period": report.get("period", "FY"),
                    "fiscal_year": report.get("fiscal_year"),
                    "reported_currency": report.get("reported_currency"),
                    "cik": report.get("cik"),
                    "filing_date": report.get("filing_date"),
                    "data": data_blob,
                }
            )

        logger.info("  %s: fetched %d rows (offset %d)", report_type, len(raw_reports), offset)
        if len(raw_reports) < page_size:
            break
        offset += page_size

    logger.info("Mapped %d %s reports for universe symbols", len(rows), report_type)
    return len(rows), rows


def _upsert_reports(sb: Client, rows: list[dict]) -> int:
    upserted = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        try:
            sb.table("financial_reports").upsert(
                batch, on_conflict="symbol,report_type,date,period"
            ).execute()
            upserted += len(batch)
        except Exception:
            logger.exception("Failed to upsert financial_reports batch %d-%d", i, i + len(batch))
    return upserted


def merge_report_rows(lse_rows: list[dict], yahoo_rows: list[dict]) -> list[dict]:
    """Prefer LSE when both sources have the same (symbol, type, date)."""
    merged: dict[tuple, dict] = {}
    for r in yahoo_rows:
        key = (r["symbol"], r["report_type"], r["date"], r["period"])
        merged[key] = r
    for r in lse_rows:
        key = (r["symbol"], r["report_type"], r["date"], r["period"])
        merged[key] = r
    return list(merged.values())


def run_financial_reports_ingest(sb: Client | None = None) -> FinancialReportsIngestResult:
    sb = sb or _get_supabase_client()
    symbols = fetch_active_symbols(sb)
    logger.info("Universe has %d active symbols", len(symbols))

    lse_ok = False
    lse_error: str | None = None
    all_lse: list[dict] = []

    lse = LSEClient()
    try:
        for rt in REPORT_TYPES:
            _, rows = _ingest_reports_for_type(lse, symbols, rt)
            all_lse.extend(rows)
        lse_ok = True
        logger.info("LSE returned %d total mapped report rows", len(all_lse))
    except Exception as exc:
        lse_error = str(exc)
        logger.exception("LSE financial reports fetch failed")
        gh_warning(f"LSE financial reports unavailable ({exc}); will use Yahoo fallback")

    lse_by_symbol: dict[str, list] = defaultdict(list)
    for r in all_lse:
        lse_by_symbol[r["symbol"]].append(r)

    if not lse_ok or not all_lse:
        yahoo_targets = symbols
    else:
        yahoo_targets = [s for s in symbols if not lse_by_symbol.get(s)]

    yahoo_rows: list[dict] = []
    if yahoo_targets:
        logger.info("Fetching Yahoo financials for %d symbols", len(yahoo_targets))
        batch = fetch_yahoo_financials_batch(yahoo_targets)
        yahoo_rows = batch.rows

    merged = merge_report_rows(all_lse, yahoo_rows)
    upserted = _upsert_reports(sb, merged) if merged else 0

    sym_with_income = {
        r["symbol"]
        for r in merged
        if r.get("report_type") == "income" and r.get("symbol") in set(symbols)
    }
    cov = len(sym_with_income) / max(1, len(symbols))
    import json
    from pathlib import Path

    cfg_path = Path(__file__).resolve().parents[2] / "shared" / "fundamentals_config.json"
    min_cov = 0.85
    if cfg_path.is_file():
        with cfg_path.open(encoding="utf-8") as fh:
            min_cov = float(json.load(fh).get("financial_reports_min_coverage", 0.85))
    if symbols and cov < min_cov:
        gh_error(
            f"financial_reports coverage {cov:.1%} below {min_cov:.0%} "
            f"({len(sym_with_income)}/{len(symbols)} symbols with FY income)"
        )

    logger.info(
        "Financial reports ingest: merged=%d upserted=%d (lse=%d yahoo=%d)",
        len(merged),
        upserted,
        len(all_lse),
        len(yahoo_rows),
    )

    stats = {
        "lse_ok": lse_ok,
        "lse_rows": len(all_lse),
        "yahoo_symbols": len(yahoo_targets),
        "yahoo_rows": len(yahoo_rows),
        "merged_rows": len(merged),
        "upserted": upserted,
        "lse_error": lse_error,
    }
    append_step_summary_json("Financial reports ingest", stats)

    return FinancialReportsIngestResult(
        lse_ok=lse_ok,
        lse_rows=len(all_lse),
        yahoo_symbols=len(yahoo_targets),
        yahoo_rows=len(yahoo_rows),
        merged_rows=len(merged),
        upserted=upserted,
        lse_error=lse_error,
        income_coverage=cov if symbols else None,
    )


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== Financial Reports Ingest Start ===")

    try:
        result = run_financial_reports_ingest()
    except Exception:
        logger.exception("Financial reports ingest crashed")
        gh_error("Financial reports ingest crashed — see logs")
        sys.exit(1)

    if result.upserted == 0:
        msg = (
            "Financial reports ingest wrote 0 rows — "
            f"LSE ok={result.lse_ok} rows={result.lse_rows}, "
            f"Yahoo symbols={result.yahoo_symbols} rows={result.yahoo_rows}. "
            "Renew LSE_API_KEY or check yfinance connectivity."
        )
        gh_error(msg)
        logger.error("=== Financial Reports Ingest FAILED: 0 rows upserted ===")
        sys.exit(1)

    if result.income_coverage is not None and result.income_coverage < 0.85:
        logger.error(
            "=== Financial Reports Ingest FAILED: income coverage %.1f%% ===",
            result.income_coverage * 100,
        )
        sys.exit(1)

    logger.info("=== Financial Reports Ingest Complete: %d upserted ===", result.upserted)


if __name__ == "__main__":
    main()