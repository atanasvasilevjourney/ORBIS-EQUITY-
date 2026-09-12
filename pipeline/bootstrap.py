"""Bootstrap: populate Orbis Equity database using yfinance (free, no API key).

Scrapes S&P 500 tickers from Wikipedia, fetches prices + fundamentals
via yfinance, then runs compute pipeline (trend_radar, f_score, aggregates).

Usage:
    python -m pipeline.bootstrap
"""
import logging
import os
import time
from datetime import datetime, timedelta, timezone

import pandas as pd
import requests
import yfinance as yf
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
logger = logging.getLogger(__name__)


def _scrape_sp500() -> list[dict]:
    """Scrape S&P 500 constituents from Wikipedia using pandas."""
    url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
    resp = requests.get(url, timeout=30, headers={"User-Agent": "OrbisEquity-Bootstrap/1.0"})
    resp.raise_for_status()
    from io import StringIO
    tables = pd.read_html(StringIO(resp.text))
    if not tables:
        return []
    df = tables[0]
    stocks = []
    for _, row in df.iterrows():
        symbol = str(row.get("Symbol", "")).replace(".", "-")
        if not symbol:
            continue
        stocks.append({
            "symbol": symbol,
            "company_name": row.get("Security", ""),
            "sector": row.get("GICS Sector", ""),
            "industry": row.get("GICS Sub-Industry", ""),
        })
    return stocks


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    sb_url = os.getenv("SUPABASE_URL", "")
    sb_key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv(
        "SUPABASE_SERVICE_ROLE_KEY", ""
    )
    if not sb_url or not sb_key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required")
        return

    sb = create_client(sb_url, sb_key)

    # ── Step 1: Universe ──────────────────────────────────────────
    logger.info("=== Step 1: Scraping S&P 500 from Wikipedia ===")
    stocks = _scrape_sp500()
    logger.info("Scraped %d S&P 500 tickers", len(stocks))

    now = datetime.now(timezone.utc).isoformat()
    universe_rows = []
    for s in stocks:
        universe_rows.append({
            "symbol": s["symbol"],
            "company_name": s["company_name"],
            "sector": s["sector"],
            "industry": s["industry"],
            "country": "US",
            "exchange": "NYSE",
            "currency": "USD",
            "tier": "us_large",
            "data_source": "yfinance",
            "fundamentals_source": "yfinance",
            "is_active": True,
            "updated_at": now,
        })

    batch_size = 500
    for i in range(0, len(universe_rows), batch_size):
        batch = universe_rows[i:i + batch_size]
        sb.table("universe_members").upsert(batch, on_conflict="symbol").execute()
    logger.info("Upserted %d universe members", len(universe_rows))

    symbols = [s["symbol"] for s in stocks]

    # ── Step 2: Prices ────────────────────────────────────────────
    logger.info("=== Step 2: Fetching prices via yfinance (last 400 days) ===")
    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=400)

    # Batch download in chunks to avoid yfinance limits
    chunk_size = 100
    all_price_rows = []

    for ci in range(0, len(symbols), chunk_size):
        chunk = symbols[ci:ci + chunk_size]
        logger.info("  Downloading prices for chunk %d-%d of %d...",
                     ci, ci + len(chunk), len(symbols))
        try:
            data = yf.download(
                tickers=chunk,
                start=start_date.isoformat(),
                end=end_date.isoformat(),
                interval="1d",
                group_by="ticker",
                auto_adjust=True,
                threads=True,
                progress=False,
            )

            if data is None or data.empty:
                continue

            for sym in chunk:
                try:
                    if len(chunk) == 1:
                        td = data
                    else:
                        if sym not in data.columns.get_level_values(0):
                            continue
                        td = data[sym]

                    td = td.dropna(subset=["Close"])
                    for date_idx, row in td.iterrows():
                        ds = date_idx.strftime("%Y-%m-%d")
                        close_val = row.get("Close")
                        if close_val is None or str(close_val).lower() == "nan":
                            continue
                        all_price_rows.append({
                            "symbol": sym,
                            "date": ds,
                            "open": float(row["Open"]) if row.get("Open") is not None else None,
                            "high": float(row["High"]) if row.get("High") is not None else None,
                            "low": float(row["Low"]) if row.get("Low") is not None else None,
                            "close": float(close_val),
                            "volume": int(row["Volume"]) if row.get("Volume") is not None else None,
                            "source": "yfinance",
                        })
                except Exception as e:
                    logger.warning("Skipping %s prices: %s", sym, e)
        except Exception as e:
            logger.warning("  Chunk download failed: %s", e)

        time.sleep(1)  # rate limit

    logger.info("Collected %d price rows, upserting...", len(all_price_rows))
    for i in range(0, len(all_price_rows), 500):
        batch = all_price_rows[i:i + 500]
        try:
            sb.table("prices_daily").upsert(batch, on_conflict="symbol,date").execute()
        except Exception as e:
            logger.warning("Price upsert batch %d failed: %s", i, e)
        if (i // 500) % 10 == 0:
            logger.info("  Prices upserted: %d/%d", i + len(batch), len(all_price_rows))
    logger.info("Prices upserted: %d rows", len(all_price_rows))

    # ── Step 3: Fundamentals ──────────────────────────────────────
    logger.info("=== Step 3: Fetching fundamentals via yfinance ===")
    fund_rows = []
    for ci, sym in enumerate(symbols):
        try:
            ticker = yf.Ticker(sym)
            info = ticker.info or {}
            if not info.get("currentPrice") and not info.get("regularMarketPrice"):
                continue

            fund_rows.append({
                "symbol": sym,
                "price": info.get("currentPrice") or info.get("regularMarketPrice"),
                "market_cap": info.get("marketCap"),
                "beta": info.get("beta"),
                "volume": info.get("volume"),
                "average_volume": info.get("averageVolume"),
                "week_52_low": info.get("fiftyTwoWeekLow"),
                "week_52_high": info.get("fiftyTwoWeekHigh"),
                "pe_ratio": info.get("trailingPE"),
                "pb_ratio": info.get("priceToBook"),
                "ps_ratio": info.get("priceToSalesTrailing12Months"),
                "ev_ebitda": info.get("enterpriseToEbitda"),
                "ev_sales": info.get("enterpriseToRevenue"),
                "earnings_yield": (1 / info["trailingPE"]) if info.get("trailingPE") and info["trailingPE"] > 0 else None,
                "dividend_yield": info.get("dividendYield"),
                "dividend_payout_ratio": info.get("payoutRatio"),
                "gross_margin": info.get("grossMargins"),
                "operating_margin": info.get("operatingMargins"),
                "net_margin": info.get("profitMargins"),
                "roe": info.get("returnOnEquity"),
                "roa": info.get("returnOnAssets"),
                "current_ratio": info.get("currentRatio"),
                "debt_to_equity": info.get("debtToEquity"),
                "revenue": info.get("totalRevenue"),
                "gross_profit": info.get("grossProfits"),
                "net_income": info.get("netIncomeToCommon"),
                "ebitda": info.get("ebitda"),
                "eps": info.get("trailingEps"),
                "revenue_growth_1y": info.get("revenueGrowth"),
                "eps_growth_1y": info.get("earningsGrowth"),
                "updated_at": now,
            })
        except Exception as e:
            logger.warning("Skipping %s fundamentals: %s", sym, e)

        if (ci + 1) % 50 == 0:
            logger.info("  Fundamentals: %d/%d fetched (%d valid)",
                         ci + 1, len(symbols), len(fund_rows))
            time.sleep(0.5)

    logger.info("Collected %d fundamental rows, upserting...", len(fund_rows))
    for i in range(0, len(fund_rows), 500):
        batch = fund_rows[i:i + 500]
        try:
            sb.table("fundamentals_snapshot").upsert(batch, on_conflict="symbol").execute()
        except Exception as e:
            logger.warning("Fundamentals upsert batch %d failed: %s", i, e)
    logger.info("Fundamentals upserted: %d rows", len(fund_rows))

    # ── Step 4: Compute pipeline ──────────────────────────────────
    logger.info("=== Step 4: Running compute pipeline ===")

    logger.info("Running trend_radar...")
    from pipeline.compute.trend_radar import main as trend_main
    trend_main()

    logger.info("Running aggregates...")
    from pipeline.compute.aggregates import main as agg_main
    agg_main()

    logger.info("Running factor scores...")
    from pipeline.compute.factor_scores import main as factor_main
    factor_main()

    logger.info("Skipping F-Score (requires financial_reports data)")

    # ── Summary ───────────────────────────────────────────────────
    counts = {}
    for table in ["universe_members", "prices_daily", "fundamentals_snapshot",
                   "trend_radar", "daily_brief"]:
        resp = sb.table(table).select("*", count="exact").limit(0).execute()
        counts[table] = resp.count
    logger.info("=== Bootstrap Complete ===")
    for t, c in counts.items():
        logger.info("  %s: %d rows", t, c)


if __name__ == "__main__":
    main()
