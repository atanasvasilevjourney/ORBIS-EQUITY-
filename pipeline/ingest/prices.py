"""Price ingest: fetch daily candles for the universe, upsert to Supabase.

For LSE-sourced tickers (US stocks): uses the lse-data Python SDK to pull
the last 5 daily candles per symbol.

For yfinance-sourced tickers (UK/EU stocks): uses yfinance batch download.

Names that still have no rows (seed_demo, LSE miss, yfinance miss) fall
through to the cash EOD client — Yahoo chart API, then Stooq — the same
public-REST / closed-bar pattern QMIE uses, on listed cash prints.

Upserts into prices_daily table with ON CONFLICT (symbol, date) DO UPDATE.

Usage:
    python -m pipeline.ingest.prices
    python -m pipeline.ingest.cash_eod   # 300-bar Yahoo/Stooq backfill
"""
import logging
import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from supabase import Client


load_dotenv()

logger = logging.getLogger(__name__)

CANDLE_LIMIT = 5  # last 5 daily bars


def _get_supabase_client() -> Client:
    """Create and return a Supabase client from env config."""
    from pipeline.utils.client import get_supabase
    return get_supabase()


from pipeline.utils.supabase import fetch_all


def _fetch_universe(sb: Client) -> list[dict]:
    """Read universe_members from Supabase to get ticker list with sources."""
    from pipeline.utils.supabase import fetch_all

    logger.info("Fetching universe_members from Supabase...")
    members = fetch_all(
        sb,
        "universe_members",
        "symbol, tier, data_source, is_active, country",
        filters=lambda q: q.eq("is_active", True),
        order=("symbol", False),
    )
    logger.info("Loaded %d active universe members", len(members))
    return members


def _ingest_lse_prices(symbols: list[str]) -> list[dict]:
    """Fetch recent daily candles via London Strategic Edge (lse-data SDK).

    Requires ``LSE_API_KEY`` (``lse_live_…``). Uses authenticated
    ``client.candles(symbol, '1d', start=…)``.
    """
    if not symbols:
        return []
    from pipeline.clients.lse_data import fetch_daily_candles, has_lse_data_key

    if not has_lse_data_key():
        logger.warning("LSE_API_KEY not set — skipping LSE candle path")
        return []

    return fetch_daily_candles(symbols, lookback_days=14, limit=max(CANDLE_LIMIT, 10))


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

    # Prefer London Strategic Edge candles when LSE_API_KEY (lse_live_…) is set.
    from pipeline.clients.lse_data import has_lse_data_key

    use_lse = has_lse_data_key()
    lse_symbols: list[str] = []
    yf_symbols: list[str] = []

    for m in members:
        symbol = m.get("symbol")
        if not symbol:
            continue
        src = (m.get("data_source") or "").lower()
        country = (m.get("country") or "").upper()
        is_eu_uk = country in ("GB", "UK", "DE", "FR", "NL", "CH", "IT", "ES", "SE", "BE")
        # Prefer LSE for US / unspecified; keep explicit EU/UK on yfinance
        if use_lse and not is_eu_uk:
            lse_symbols.append(symbol)
        else:
            yf_symbols.append(symbol)

    # De-dupe
    seen: set[str] = set()
    lse_symbols = [s for s in lse_symbols if not (s in seen or seen.add(s))]
    yf_seen = set(lse_symbols)
    yf_symbols = [s for s in yf_symbols if s not in yf_seen]

    logger.info(
        "Price sources: %d LSE%s, %d yfinance",
        len(lse_symbols),
        " (key present)" if use_lse else "",
        len(yf_symbols),
    )

    all_rows: list[dict] = []

    if lse_symbols and use_lse:
        all_rows.extend(_ingest_lse_prices(lse_symbols))

    # Anything LSE missed falls through to yfinance
    got = {r.get("symbol") for r in all_rows if r.get("symbol")}
    yf_symbols = list(dict.fromkeys(yf_symbols + [m["symbol"] for m in members if m.get("symbol") not in got]))

    if yf_symbols:
        all_rows.extend(_ingest_yfinance_prices(yf_symbols))

    got = {r.get("symbol") for r in all_rows if r.get("symbol")}
    leftover = [m for m in members if m.get("symbol") not in got]
    if leftover:
        from pipeline.clients.cash_eod import bars_to_rows, fetch_daily_bars

        logger.info(
            "Cash EOD fallback for %d seed/unknown names with no LSE/yfinance rows",
            len(leftover),
        )
        for m in leftover:
            symbol = m.get("symbol")
            try:
                bars, src = fetch_daily_bars(
                    symbol, country=m.get("country"), bars=max(CANDLE_LIMIT, 10)
                )
                all_rows.extend(bars_to_rows(bars))
                logger.info("cash EOD %s via %s (%d bars)", symbol, src, len(bars))
            except Exception:
                logger.warning("cash EOD fallback failed for %s", symbol, exc_info=True)

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
