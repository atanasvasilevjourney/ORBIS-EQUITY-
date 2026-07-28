"""Price ingest: fetch daily candles for the universe, upsert to Supabase.

For LSE-sourced tickers (US stocks): uses the lse-data Python SDK to pull
the last 5 daily candles per symbol.

For yfinance-sourced tickers (UK/EU stocks): uses yfinance batch download.

Upserts into prices_daily table with ON CONFLICT (symbol, date) DO UPDATE.

Usage:
    python -m pipeline.ingest.prices
"""
import logging
import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from supabase import create_client, Client

from pipeline.config.settings import SupabaseConfig

load_dotenv()

logger = logging.getLogger(__name__)

CANDLE_LIMIT = 5  # last 5 daily bars


def _get_supabase_client() -> Client:
    """Create and return a Supabase client from env config."""
    cfg = SupabaseConfig()
    if not cfg.url or not cfg.service_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in environment"
        )
    return create_client(cfg.url, cfg.service_key)


def _fetch_universe(sb: Client) -> list[dict]:
    """Read universe_members from Supabase to get ticker list with sources."""
    logger.info("Fetching universe_members from Supabase...")
    result = (
        sb.table("universe_members")
        .select("symbol, tier, price_source, is_active")
        .eq("is_active", True)
        .execute()
    )
    members = result.data or []
    logger.info("Loaded %d active universe members", len(members))
    return members


def _ingest_lse_prices(symbols: list[str]) -> list[dict]:
    """Fetch last 5 daily candles from the lse-data SDK for each symbol.

    Uses: from lse import LSE; client.candles(symbol, '1d', limit=5)
    """
    rows: list[dict] = []
    try:
        from lse import LSE
        client = LSE()
    except ImportError:
        logger.error("lse-data SDK not installed — run: pip install lse-data")
        return rows
    except Exception:
        logger.exception("Failed to initialize LSE data client")
        return rows

    total = len(symbols)
    success = 0
    failed = 0

    for idx, symbol in enumerate(symbols, 1):
        try:
            candles = client.candles(symbol, "1d", limit=CANDLE_LIMIT)
            if not candles:
                logger.debug("No candles returned for %s", symbol)
                continue

            for c in candles:
                rows.append({
                    "symbol": symbol,
                    "date": c.get("date") or c.get("t") or c.get("timestamp"),
                    "open": c.get("open") or c.get("o"),
                    "high": c.get("high") or c.get("h"),
                    "low": c.get("low") or c.get("l"),
                    "close": c.get("close") or c.get("c"),
                    "volume": c.get("volume") or c.get("v"),
                    "source": "lse",
                })
            success += 1
        except Exception:
            logger.warning("Failed to fetch LSE candles for %s", symbol, exc_info=True)
            failed += 1

        if idx % 100 == 0:
            logger.info("LSE prices: %d/%d processed (%d ok, %d fail)", idx, total, success, failed)

    logger.info(
        "LSE price fetch complete: %d/%d succeeded, %d rows", success, total, len(rows)
    )
    return rows


def _ingest_yfinance_prices(symbols: list[str]) -> list[dict]:
    """Fetch last 5 daily candles via yfinance batch download for UK/EU tickers."""
    rows: list[dict] = []
    if not symbols:
        return rows

    try:
        import yfinance as yf
    except ImportError:
        logger.error("yfinance not installed — run: pip install yfinance")
        return rows

    logger.info("Downloading yfinance data for %d tickers...", len(symbols))

    # yfinance batch download — fetch 10 calendar days to ensure 5 trading days
    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=10)

    try:
        data = yf.download(
            tickers=symbols,
            start=start_date.isoformat(),
            end=end_date.isoformat(),
            interval="1d",
            group_by="ticker",
            auto_adjust=True,
            threads=True,
        )
    except Exception:
        logger.exception("yfinance batch download failed")
        return rows

    if data is None or data.empty:
        logger.warning("yfinance returned empty dataframe")
        return rows

    success = 0
    failed = 0

    for symbol in symbols:
        try:
            if len(symbols) == 1:
                ticker_data = data
            else:
                if symbol not in data.columns.get_level_values(0):
                    logger.debug("No yfinance data for %s", symbol)
                    failed += 1
                    continue
                ticker_data = data[symbol]

            # Drop rows where close is NaN
            ticker_data = ticker_data.dropna(subset=["Close"])

            # Take last 5 trading days
            ticker_data = ticker_data.tail(CANDLE_LIMIT)

            for date_idx, row in ticker_data.iterrows():
                date_str = date_idx.strftime("%Y-%m-%d") if hasattr(date_idx, "strftime") else str(date_idx)
                rows.append({
                    "symbol": symbol,
                    "date": date_str,
                    "open": float(row.get("Open", 0)) if row.get("Open") is not None else None,
                    "high": float(row.get("High", 0)) if row.get("High") is not None else None,
                    "low": float(row.get("Low", 0)) if row.get("Low") is not None else None,
                    "close": float(row.get("Close", 0)) if row.get("Close") is not None else None,
                    "volume": int(row.get("Volume", 0)) if row.get("Volume") is not None else None,
                    "source": "yfinance",
                })
            success += 1
        except Exception:
            logger.warning("Failed to process yfinance data for %s", symbol, exc_info=True)
            failed += 1

    logger.info(
        "yfinance fetch complete: %d/%d succeeded, %d rows", success, len(symbols), len(rows)
    )
    return rows


def _normalize_date(date_val) -> str | None:
    """Ensure date value is a YYYY-MM-DD string."""
    if date_val is None:
        return None
    if isinstance(date_val, str):
        # Already a string — take the date portion
        return date_val[:10]
    if hasattr(date_val, "strftime"):
        return date_val.strftime("%Y-%m-%d")
    return str(date_val)[:10]


def main() -> None:
    """Fetch prices for the full universe and upsert into prices_daily."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("=== Price Ingest Start ===")

    sb = _get_supabase_client()
    members = _fetch_universe(sb)

    if not members:
        logger.error("No universe members found — run universe sync first.")
        return

    # Split by price_source
    lse_symbols = [m["symbol"] for m in members if m.get("price_source") == "lse"]
    yf_symbols = [m["symbol"] for m in members if m.get("price_source") in ("yfinance", "both")]

    logger.info(
        "Price sources: %d LSE, %d yfinance", len(lse_symbols), len(yf_symbols)
    )

    # Fetch prices from each source
    all_rows: list[dict] = []

    if lse_symbols:
        all_rows.extend(_ingest_lse_prices(lse_symbols))

    if yf_symbols:
        all_rows.extend(_ingest_yfinance_prices(yf_symbols))

    if not all_rows:
        logger.warning("No price rows collected — nothing to upsert.")
        return

    # Normalize dates and filter out rows with missing critical fields
    clean_rows: list[dict] = []
    for row in all_rows:
        row["date"] = _normalize_date(row.get("date"))
        if row["date"] and row.get("symbol"):
            # Remove NaN/None numeric fields that would fail upsert
            for field in ("open", "high", "low", "close", "volume"):
                val = row.get(field)
                if val is not None:
                    try:
                        if str(val).lower() == "nan":
                            row[field] = None
                    except (ValueError, TypeError):
                        row[field] = None
            row["updated_at"] = datetime.now(timezone.utc).isoformat()
            clean_rows.append(row)

    logger.info("Upserting %d price rows into prices_daily...", len(clean_rows))

    # Batch upsert
    batch_size = 500
    upserted = 0

    for i in range(0, len(clean_rows), batch_size):
        batch = clean_rows[i : i + batch_size]
        try:
            sb.table("prices_daily").upsert(
                batch, on_conflict="symbol,date"
            ).execute()
            upserted += len(batch)
            logger.info(
                "Upserted batch %d-%d (%d/%d)",
                i, i + len(batch), upserted, len(clean_rows),
            )
        except Exception:
            logger.exception(
                "Failed to upsert price batch %d-%d", i, i + len(batch)
            )

    logger.info(
        "=== Price Ingest Complete: %d/%d rows upserted ===",
        upserted, len(clean_rows),
    )


if __name__ == "__main__":
    main()
