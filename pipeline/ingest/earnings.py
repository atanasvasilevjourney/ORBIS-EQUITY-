"""Earnings calendar ingest: LSE primary, Yahoo Finance fallback → Supabase.

Fetches earnings for the index research desk from the LSE API when the key
works; fills gaps (or the full universe on LSE failure) via yfinance.

Usage:
    python -m pipeline.ingest.earnings
"""
from __future__ import annotations

import logging
import os
import sys
from collections import defaultdict
from dataclasses import dataclass

from dotenv import load_dotenv
from supabase import Client, create_client

from pipeline.clients.lse_api import LSEClient
from pipeline.clients.yahoo_earnings import fetch_yahoo_earnings_batch
from pipeline.config.settings import SupabaseConfig
from pipeline.universe_filters import research_desk_symbols
from pipeline.utils.ci_log import append_step_summary_json, gh_error, gh_warning
from pipeline.utils.supabase import fetch_all

load_dotenv()

logger = logging.getLogger(__name__)

BATCH_SIZE = 500


@dataclass
class EarningsIngestResult:
    lse_ok: bool
    lse_rows: int
    yahoo_symbols: int
    yahoo_rows: int
    merged_rows: int
    upserted: int
    lse_error: str | None = None


def _get_supabase_client() -> Client:
    cfg = SupabaseConfig()
    if not cfg.url or not cfg.service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
    return create_client(cfg.url, cfg.service_key)


def _safe_int(val) -> int | None:
    if val is None:
        return None
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return None


def fetch_research_desk_symbols(sb: Client) -> list[str]:
    rows = fetch_all(
        sb,
        "universe_members",
        "symbol, tier, sector, industry, company_name, is_active",
        filters=lambda q: q.eq("is_active", True),
    )
    return sorted(research_desk_symbols(rows))


def map_lse_earnings(raw: list[dict], universe_set: set[str]) -> list[dict]:
    rows: list[dict] = []
    for e in raw:
        symbol = e.get("symbol")
        if not symbol or symbol not in universe_set:
            continue
        event_date = e.get("event_date")
        if not event_date:
            continue
        eps_est = e.get("eps_estimated")
        eps_actual = e.get("eps_actual")
        surprise_pct = None
        if eps_est is not None and eps_actual is not None and eps_est != 0:
            surprise_pct = round(((eps_actual - eps_est) / abs(eps_est)) * 100, 2)
        rows.append(
            {
                "ticker": symbol,
                "event_date": str(event_date)[:10],
                "confirmed": eps_actual is not None,
                "source": "lse",
                "eps_est": eps_est,
                "eps_actual": eps_actual,
                "surprise_pct": surprise_pct,
                "revenue_est": _safe_int(e.get("revenue_estimated")),
                "revenue_actual": _safe_int(e.get("revenue_actual")),
            }
        )
    return rows


def merge_earnings_rows(lse_rows: list[dict], yahoo_rows: list[dict]) -> list[dict]:
    merged: dict[tuple[str, str], dict] = {}
    for r in lse_rows:
        merged[(r["ticker"], r["event_date"])] = r
    for r in yahoo_rows:
        key = (r["ticker"], r["event_date"])
        if key not in merged:
            merged[key] = r
    return list(merged.values())


def upsert_earnings(sb: Client, rows: list[dict]) -> int:
    upserted = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        sb.table("earnings_calendar").upsert(batch, on_conflict="ticker,event_date").execute()
        upserted += len(batch)
        logger.info("Earnings upserted %d/%d", upserted, len(rows))
    return upserted


def run_earnings_ingest(sb: Client | None = None) -> EarningsIngestResult:
    sb = sb or _get_supabase_client()
    symbols = fetch_research_desk_symbols(sb)
    universe_set = set(symbols)
    logger.info("Research desk has %d symbols for earnings", len(symbols))

    lse_ok = False
    lse_error: str | None = None
    lse_rows: list[dict] = []

    lse = LSEClient()
    try:
        raw = lse.get_earnings(limit=5000)
        lse_rows = map_lse_earnings(raw, universe_set)
        lse_ok = True
        logger.info("LSE returned %d mapped earnings rows", len(lse_rows))
    except Exception as exc:
        lse_error = str(exc)
        logger.exception("LSE earnings fetch failed")
        gh_warning(f"LSE earnings unavailable ({exc}); will use Yahoo fallback")

    lse_by_symbol: dict[str, list] = defaultdict(list)
    for r in lse_rows:
        lse_by_symbol[r["ticker"]].append(r)

    if not lse_ok or not lse_rows:
        yahoo_targets = symbols
    else:
        yahoo_targets = [s for s in symbols if not lse_by_symbol.get(s)]

    max_yahoo = int(os.getenv("EARNINGS_YAHOO_MAX_SYMBOLS", "500"))
    if len(yahoo_targets) > max_yahoo:
        logger.warning(
            "Capping Yahoo earnings fetch from %d to %d symbols",
            len(yahoo_targets),
            max_yahoo,
        )
        yahoo_targets = yahoo_targets[:max_yahoo]

    yahoo_rows: list[dict] = []
    if yahoo_targets:
        logger.info("Fetching Yahoo earnings for %d symbols", len(yahoo_targets))
        batch = fetch_yahoo_earnings_batch(yahoo_targets)
        yahoo_rows = batch.rows

    merged = merge_earnings_rows(lse_rows, yahoo_rows)
    upserted = 0
    if merged:
        upserted = upsert_earnings(sb, merged)

    reported = sum(1 for r in merged if r.get("confirmed"))
    beats = sum(
        1 for r in merged if r.get("surprise_pct") is not None and r["surprise_pct"] > 0
    )
    misses = sum(
        1 for r in merged if r.get("surprise_pct") is not None and r["surprise_pct"] < 0
    )
    logger.info(
        "Earnings ingest: merged=%d upserted=%d (lse=%d yahoo=%d) | reported=%d beats=%d misses=%d",
        len(merged),
        upserted,
        len(lse_rows),
        len(yahoo_rows),
        reported,
        beats,
        misses,
    )

    stats = {
        "lse_ok": lse_ok,
        "lse_rows": len(lse_rows),
        "yahoo_symbols": len(yahoo_targets),
        "yahoo_rows": len(yahoo_rows),
        "merged_rows": len(merged),
        "upserted": upserted,
        "reported": reported,
        "beats": beats,
        "misses": misses,
        "lse_error": lse_error,
    }
    append_step_summary_json("Earnings ingest", stats)

    return EarningsIngestResult(
        lse_ok=lse_ok,
        lse_rows=len(lse_rows),
        yahoo_symbols=len(yahoo_targets),
        yahoo_rows=len(yahoo_rows),
        merged_rows=len(merged),
        upserted=upserted,
        lse_error=lse_error,
    )


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== Earnings Ingest Start ===")

    try:
        result = run_earnings_ingest()
    except Exception:
        logger.exception("Earnings ingest crashed")
        gh_error("Earnings ingest crashed — see logs")
        sys.exit(1)

    if result.upserted == 0:
        msg = (
            "Earnings ingest wrote 0 rows — "
            f"LSE ok={result.lse_ok} rows={result.lse_rows}, "
            f"Yahoo symbols={result.yahoo_symbols} rows={result.yahoo_rows}. "
            "Renew LSE_API_KEY or check yfinance connectivity."
        )
        gh_error(msg)
        logger.error("=== Earnings Ingest FAILED: 0 rows upserted ===")
        sys.exit(1)

    logger.info("=== Earnings Ingest Complete: %d upserted ===", result.upserted)


if __name__ == "__main__":
    main()