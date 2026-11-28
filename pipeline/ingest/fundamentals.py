"""Fundamentals ingest: screener metrics + insider trades to Supabase.

Fetches the full LSE screener dataset (1,472 stocks, 50+ metrics) and
upserts into fundamentals_snapshot.  Also fetches recent insider trades
(last 30 days) and upserts into insider_trades_snapshot.

Usage:
    python -m pipeline.ingest.fundamentals
"""
import json
import logging
import os
from datetime import date, datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from supabase import create_client, Client

from pipeline.config.settings import LSEConfig, SupabaseConfig, SCREENER_FIELDS
from pipeline.clients.lse_api import LSEClient
from pipeline.utils.market_cap import normalize_market_cap_usd
from pipeline.utils.supabase import fetch_active_symbols

load_dotenv()

logger = logging.getLogger(__name__)

# Mapping from LSE screener field names to fundamentals_snapshot columns.
# Keys = screener API field, Values = Supabase column name.
# Where names match 1:1, the mapping is identity.  Adjust if the DB schema
# uses different column names.
FUNDAMENTALS_FIELD_MAP: dict[str, str] = {
    "symbol": "symbol",
    # Price & market
    "price": "price",
    "market_cap": "market_cap",
    "beta": "beta",
    "volume": "volume",
    "average_volume": "average_volume",
    "week_52_low": "week_52_low",
    "week_52_high": "week_52_high",
    # Valuation
    "pe_ratio": "pe_ratio",
    "pb_ratio": "pb_ratio",
    "ps_ratio": "ps_ratio",
    "p_fcf_ratio": "p_fcf_ratio",
    "ev_ebitda": "ev_ebitda",
    "ev_sales": "ev_sales",
    "earnings_yield": "earnings_yield",
    "fcf_yield": "fcf_yield",
    # Dividends
    "dividend_yield": "dividend_yield",
    "dividend_payout_ratio": "dividend_payout_ratio",
    "dividend_per_share": "dividend_per_share",
    # Profitability
    "gross_margin": "gross_margin",
    "operating_margin": "operating_margin",
    "net_margin": "net_margin",
    "roe": "roe",
    "roa": "roa",
    "roic": "roic",
    # Balance sheet
    "current_ratio": "current_ratio",
    "quick_ratio": "quick_ratio",
    "cash_ratio": "cash_ratio",
    "debt_to_equity": "debt_to_equity",
    "debt_to_assets": "debt_to_assets",
    # Income
    "revenue": "revenue",
    "gross_profit": "gross_profit",
    "operating_income": "operating_income",
    "net_income": "net_income",
    "ebitda": "ebitda",
    "eps": "eps",
    "eps_diluted": "eps_diluted",
    # Growth
    "revenue_growth_1y": "revenue_growth_1y",
    "revenue_growth_3y": "revenue_growth_3y",
    "revenue_growth_5y": "revenue_growth_5y",
    "net_income_growth_1y": "net_income_growth_1y",
    "net_income_growth_3y": "net_income_growth_3y",
    "net_income_growth_5y": "net_income_growth_5y",
    "eps_growth_1y": "eps_growth_1y",
    "dividend_growth_1y": "dividend_growth_1y",
    "book_value_growth_1y": "book_value_growth_1y",
    # Meta
    "ratios_date": "ratios_date",
}

# Insider trades field mapping (LSE API -> insider_trades_snapshot columns)
INSIDER_FIELD_MAP: dict[str, str] = {
    "symbol": "symbol",
    "filing_date": "filing_date",
    "transaction_date": "transaction_date",
    "reporting_name": "reporting_name",
    "transaction_type": "transaction_type",
    "securities_transacted": "securities_transacted",
    "price": "price",
    "type_of_owner": "type_of_owner",
    "form_type": "form_type",
}


def _get_supabase_client() -> Client:
    """Create and return a Supabase client from env config."""
    cfg = SupabaseConfig()
    if not cfg.url or not cfg.service_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in environment"
        )
    return create_client(cfg.url, cfg.service_key)


def _norm_margin(raw) -> float | None:
    if raw is None:
        return None
    try:
        x = float(raw)
    except (TypeError, ValueError):
        return None
    if abs(x) > 1.5:
        x = x / 100.0
    if x < -1 or x > 1:
        return None
    return x


def _sanitize_margin_fields(row: dict) -> dict:
    """Drop operating margin when it exceeds gross (vendor field/period mix)."""
    gross = _norm_margin(row.get("gross_margin"))
    op = _norm_margin(row.get("operating_margin"))
    net = _norm_margin(row.get("net_margin"))
    row["gross_margin"] = gross
    row["operating_margin"] = op
    row["net_margin"] = net
    if gross is not None and op is not None and op > gross + 1e-6:
        row["operating_margin"] = None
    return row


def _map_row(raw: dict, field_map: dict[str, str]) -> dict:
    """Map a raw API row to DB columns using the given field map."""
    mapped: dict = {}
    for src_key, dst_key in field_map.items():
        if src_key in raw:
            mapped[dst_key] = raw[src_key]
    return _sanitize_margin_fields(mapped)


def _ingest_fundamentals(lse: LSEClient, sb: Client) -> tuple[int, list[dict]]:
    """Fetch screener data and upsert into fundamentals_snapshot.

    Returns the number of rows successfully upserted.
    """
    logger.info("Fetching all screener data from LSE API...")
    try:
        stocks = lse.get_all_screener_data()
    except requests.HTTPError as err:
        logger.error(
            "LSE screener failed (%s) — keeping existing fundamentals_snapshot",
            err,
        )
        return 0, [], []
    logger.info("Received %d stocks from screener", len(stocks))

    if not stocks:
        logger.warning("No screener data returned — skipping fundamentals upsert.")
        return 0, []

    now = datetime.now(timezone.utc).isoformat()
    rows: list[dict] = []

    for stock in stocks:
        symbol = stock.get("symbol")
        if not symbol:
            continue

        row = _map_row(stock, FUNDAMENTALS_FIELD_MAP)
        row["updated_at"] = now
        price = row.get("price")
        if row.get("market_cap") is not None:
            try:
                m = normalize_market_cap_usd(float(row["market_cap"]), float(price) if price else None)
                if m is not None:
                    row["market_cap"] = m
            except (TypeError, ValueError):
                pass
        rows.append(row)

    logger.info("Mapped %d fundamental rows for upsert", len(rows))

    # Batch upsert
    batch_size = 500
    upserted = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            sb.table("fundamentals_snapshot").upsert(
                batch, on_conflict="symbol"
            ).execute()
            upserted += len(batch)
            logger.info(
                "Fundamentals upserted batch %d-%d (%d/%d)",
                i, i + len(batch), upserted, len(rows),
            )
        except Exception:
            logger.exception(
                "Failed to upsert fundamentals batch %d-%d", i, i + len(batch)
            )

    return upserted, rows


def _ingest_insider_trades(lse: LSEClient, sb: Client) -> int:
    """Fetch insider trades (last 30 days) and upsert into insider_trades_snapshot.

    Returns the number of rows successfully upserted.
    """
    logger.info("Fetching insider trades (last 30 days) from LSE API...")
    try:
        trades = lse.get_insider_trades(days_back=30, limit=5000)
    except Exception:
        logger.exception("Failed to fetch insider trades from LSE API")
        return 0

    logger.info("Received %d insider trade records", len(trades))

    if not trades:
        logger.info("No insider trades in the last 30 days.")
        return 0

    now = datetime.now(timezone.utc).isoformat()
    rows: list[dict] = []

    for trade in trades:
        symbol = trade.get("symbol")
        if not symbol:
            continue

        row = _map_row(trade, INSIDER_FIELD_MAP)

        # Ensure we have a filing_date for conflict resolution
        if not row.get("filing_date"):
            continue

        rows.append(row)

    logger.info("Mapped %d insider trade rows for upsert", len(rows))

    # Batch upsert
    batch_size = 500
    upserted = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            sb.table("insider_trades_snapshot").upsert(
                batch, on_conflict="symbol,filing_date,reporting_name,transaction_type"
            ).execute()
            upserted += len(batch)
            logger.info(
                "Insider trades upserted batch %d-%d (%d/%d)",
                i, i + len(batch), upserted, len(rows),
            )
        except Exception:
            logger.exception(
                "Failed to upsert insider trades batch %d-%d", i, i + len(batch)
            )

    return upserted


def _coverage_guard(sb, upserted_rows: list[dict]) -> tuple[float, int, int, float]:
    cfg_path = Path(__file__).resolve().parents[2] / "shared" / "fundamentals_config.json"
    with cfg_path.open(encoding="utf-8") as fh:
        cfg = json.load(fh)
    max_age = int(cfg.get("ratios_max_age_days", 120))
    min_cov = float(cfg.get("screener_min_coverage", 0.85))
    active = set(fetch_active_symbols(sb))
    cutoff = date.today() - __import__("datetime").timedelta(days=max_age)
    fresh = 0
    for row in upserted_rows:
        sym = row.get("symbol")
        if sym not in active:
            continue
        rd = row.get("ratios_date")
        if rd:
            try:
                if date.fromisoformat(str(rd)[:10]) >= cutoff:
                    fresh += 1
            except ValueError:
                pass
    expected = len(active) or 1
    cov = fresh / expected
    return cov, fresh, len(active), min_cov


def main() -> None:
    """Fetch fundamentals + insider trades and upsert into Supabase."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== Fundamentals Ingest Start ===")

    from pipeline.utils.run_recorded import run_recorded

    def _run(sb, run) -> None:
        lse = LSEClient()
        # 1. Fundamentals snapshot
        fund_count, rows = _ingest_fundamentals(lse, sb)
        if fund_count == 0:
            run.mark_error("fundamentals ingest wrote 0 rows")
        elif rows:
            cov, fresh, expected, min_cov = _coverage_guard(sb, rows)
            run.set_row_counts(
                fundamentals=fund_count,
                ratios_fresh=fresh,
                ratios_expected=expected,
                ratios_coverage_pct=round(cov * 100, 1),
            )
            if cov < min_cov:
                run.mark_error(
                    f"ratios coverage {cov:.1%} below {min_cov:.0%} ({fresh}/{expected} fresh)"
                )
        else:
            run.set_row_counts(fundamentals=0)

        insider_count = _ingest_insider_trades(lse, sb)
        run.set_row_counts(insider=insider_count)
        run.set_headline(f"{fund_count} fundamentals upserted")

    run_recorded("ingest.fundamentals", _run)

if __name__ == "__main__":
    main()
