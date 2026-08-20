"""Seed the local KovaView database with deterministic demo data.

This is a LOCAL DEVELOPMENT helper. It writes synthetic (not real-market)
data through the same Supabase/PostgREST service path the nightly pipeline
uses, so the whole stack can be exercised end-to-end without external APIs
(LSE / yfinance / GDELT).

After seeding raw tables it does NOT compute signals — run the real compute
pipeline afterwards:

    python -m pipeline.compute.trend_radar
    python -m pipeline.compute.aggregates
    python -m pipeline.compute.factor_scores

Usage:
    python -m scripts.seed_demo
"""
from __future__ import annotations

import logging
import math
import os
import random
from datetime import date, datetime, timedelta, timezone

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(".env")
load_dotenv(".env.local")

logger = logging.getLogger("seed_demo")

TRADING_DAYS = 320
SEED = 42

# (symbol, company, sector, industry, country, exchange, regime)
# regime tunes the synthetic price path: drift (annualised-ish) + volatility
STOCKS = [
    ("AAPL", "Apple Inc.", "Technology", "Consumer Electronics", "US", "NASDAQ", ("up", 0.0011, 0.016)),
    ("MSFT", "Microsoft Corp.", "Technology", "Software", "US", "NASDAQ", ("up", 0.0010, 0.014)),
    ("NVDA", "NVIDIA Corp.", "Technology", "Semiconductors", "US", "NASDAQ", ("up", 0.0018, 0.028)),
    ("JPM", "JPMorgan Chase & Co.", "Financials", "Banks", "US", "NYSE", ("up", 0.0007, 0.013)),
    ("GS", "Goldman Sachs Group", "Financials", "Capital Markets", "US", "NYSE", ("side", 0.0001, 0.015)),
    ("XOM", "Exxon Mobil Corp.", "Energy", "Oil & Gas", "US", "NYSE", ("side", 0.0002, 0.017)),
    ("CVX", "Chevron Corp.", "Energy", "Oil & Gas", "US", "NYSE", ("down", -0.0008, 0.018)),
    ("JNJ", "Johnson & Johnson", "Health Care", "Pharmaceuticals", "US", "NYSE", ("down", -0.0006, 0.011)),
    ("PFE", "Pfizer Inc.", "Health Care", "Pharmaceuticals", "US", "NYSE", ("down", -0.0012, 0.015)),
    ("MRNA", "Moderna Inc.", "Health Care", "Biotechnology", "US", "NASDAQ", ("up", 0.0016, 0.030)),
    ("MRK", "Merck & Co. Inc.", "Health Care", "Pharmaceuticals", "US", "NYSE", ("up", 0.0009, 0.012)),
    ("PG", "Procter & Gamble", "Consumer Staples", "Household Products", "US", "NYSE", ("side", 0.0002, 0.009)),
    ("KO", "Coca-Cola Co.", "Consumer Staples", "Beverages", "US", "NYSE", ("up", 0.0005, 0.010)),
    ("HD", "Home Depot Inc.", "Consumer Discretionary", "Home Improvement", "US", "NYSE", ("up", 0.0008, 0.014)),
    ("TSLA", "Tesla Inc.", "Consumer Discretionary", "Automobiles", "US", "NASDAQ", ("down", -0.0010, 0.032)),
    ("SHEL", "Shell plc", "Energy", "Oil & Gas", "GB", "LSE", ("side", 0.0001, 0.015)),
    ("AZN", "AstraZeneca plc", "Health Care", "Pharmaceuticals", "GB", "LSE", ("up", 0.0009, 0.013)),
    ("SAP", "SAP SE", "Technology", "Software", "DE", "XETRA", ("up", 0.0007, 0.013)),
]


def _price_path(regime: tuple[str, float, float], start: float, rng: random.Random) -> list[dict]:
    _name, drift, vol = regime
    end = date.today()
    rows: list[dict] = []
    px = start
    # walk backwards then forwards to fill TRADING_DAYS business days ending today
    days: list[date] = []
    d = end
    while len(days) < TRADING_DAYS:
        if d.weekday() < 5:  # Mon-Fri
            days.append(d)
        d -= timedelta(days=1)
    days.reverse()

    for i, dd in enumerate(days):
        shock = rng.gauss(0, 1)
        # add a mild cyclical component so ATR compresses then expands (breakout signal)
        cyc = 0.4 * math.sin(i / 22.0)
        ret = drift + vol * (shock + cyc)
        px = max(1.0, px * (1.0 + ret))
        intraday = vol * px
        high = px + abs(rng.gauss(0, 1)) * intraday
        low = px - abs(rng.gauss(0, 1)) * intraday
        low = max(0.5, min(low, px))
        high = max(high, px)
        openp = low + (high - low) * rng.random()
        base_vol = 2_000_000 + int(abs(rng.gauss(0, 1)) * 800_000)
        rows.append({
            "date": dd.isoformat(),
            "open": round(openp, 2),
            "high": round(high, 2),
            "low": round(low, 2),
            "close": round(px, 2),
            "volume": base_vol,
            "source": "seed_demo",
        })
    return rows


def _fundamentals(symbol: str, regime_name: str, last_close: float, rng: random.Random) -> dict:
    # Bias the factor inputs by regime so factor scores spread across the universe.
    if regime_name == "up":
        pe = rng.uniform(18, 34); roe = rng.uniform(0.18, 0.42); growth = rng.uniform(0.10, 0.30)
    elif regime_name == "down":
        pe = rng.uniform(8, 16); roe = rng.uniform(-0.05, 0.10); growth = rng.uniform(-0.15, 0.03)
    else:
        pe = rng.uniform(12, 22); roe = rng.uniform(0.08, 0.18); growth = rng.uniform(0.0, 0.10)

    ey = 1.0 / pe if pe > 0 else None
    return {
        "symbol": symbol,
        "price": round(last_close, 2),
        "market_cap": round(last_close * rng.uniform(1.0e9, 3.0e9), 0),
        "beta": round(rng.uniform(0.7, 1.6), 2),
        "volume": 3_000_000,
        "average_volume": 2_800_000,
        "week_52_low": round(last_close * 0.7, 2),
        "week_52_high": round(last_close * 1.25, 2),
        "pe_ratio": round(pe, 2),
        "pb_ratio": round(rng.uniform(1.5, 9.0), 2),
        "ps_ratio": round(rng.uniform(1.0, 12.0), 2),
        "ev_ebitda": round(rng.uniform(6, 25), 2),
        "earnings_yield": round(ey, 4) if ey else None,
        "fcf_yield": round(rng.uniform(0.01, 0.09), 4),
        "dividend_yield": round(rng.uniform(0.0, 0.04), 4),
        "gross_margin": round(rng.uniform(0.25, 0.70), 3),
        "operating_margin": round(rng.uniform(0.08, 0.40), 3),
        "net_margin": round(rng.uniform(0.05, 0.32), 3),
        "roe": round(roe, 3),
        "roa": round(roe * rng.uniform(0.4, 0.7), 3),
        "roic": round(roe * rng.uniform(0.5, 0.8), 3),
        "current_ratio": round(rng.uniform(0.9, 3.2), 2),
        "debt_to_equity": round(rng.uniform(0.1, 2.2), 2),
        "revenue": round(rng.uniform(2.0e10, 2.0e11), 0),
        "net_income": round(rng.uniform(2.0e9, 4.0e10), 0),
        "eps": round(last_close / pe, 2) if pe > 0 else None,
        "revenue_growth_1y": round(growth, 3),
        "revenue_growth_3y": round(growth * rng.uniform(0.7, 1.1), 3),
        "eps_growth_1y": round(growth * rng.uniform(0.8, 1.4), 3),
        "net_income_growth_1y": round(growth * rng.uniform(0.8, 1.3), 3),
        "f_score": rng.randint(3, 9),
        "source": "seed_demo",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required (see .env.local)")
        raise SystemExit(1)

    sb = create_client(url, key)
    rng = random.Random(SEED)
    now = datetime.now(timezone.utc).isoformat()

    # 1. Universe -----------------------------------------------------------
    universe_rows = []
    for sym, name, sector, industry, country, exch, _regime in STOCKS:
        universe_rows.append({
            "symbol": sym, "company_name": name, "sector": sector, "industry": industry,
            "country": country, "exchange": exch, "currency": "USD" if country == "US" else ("GBP" if country == "GB" else "EUR"),
            "tier": "us_large" if country == "US" else ("uk" if country == "GB" else "eu"),
            "data_source": "seed_demo", "fundamentals_source": "seed_demo",
            "is_active": True, "updated_at": now,
        })
    sb.table("universe_members").upsert(universe_rows, on_conflict="symbol").execute()
    logger.info("universe_members: %d rows", len(universe_rows))

    # 2. Prices + 3. Fundamentals ------------------------------------------
    all_prices: list[dict] = []
    fund_rows: list[dict] = []
    for sym, _name, _sector, _industry, _country, _exch, regime in STOCKS:
        start = rng.uniform(40, 400)
        path = _price_path(regime, start, rng)
        for p in path:
            p2 = dict(p); p2["symbol"] = sym
            all_prices.append(p2)
        fund_rows.append(_fundamentals(sym, regime[0], path[-1]["close"], rng))

    for i in range(0, len(all_prices), 500):
        sb.table("prices_daily").upsert(all_prices[i:i + 500], on_conflict="symbol,date").execute()
    logger.info("prices_daily: %d rows", len(all_prices))

    sb.table("fundamentals_snapshot").upsert(fund_rows, on_conflict="symbol").execute()
    logger.info("fundamentals_snapshot: %d rows", len(fund_rows))

    # 4. Earnings calendar --------------------------------------------------
    today = date.today()
    earnings_rows = []
    for idx, (sym, *_rest) in enumerate(STOCKS):
        # a reported result in the recent past
        ev_past = (today - timedelta(days=3 + idx)).isoformat()
        est = round(rng.uniform(0.8, 3.5), 2)
        surprise = round(rng.uniform(-12, 18), 1)
        actual = round(est * (1 + surprise / 100.0), 2)
        earnings_rows.append({
            "ticker": sym, "event_date": ev_past, "confirmed": True, "source": "seed_demo",
            "eps_est": est, "eps_actual": actual, "surprise_pct": surprise,
            "revenue_est": int(rng.uniform(1e10, 5e10)), "revenue_actual": int(rng.uniform(1e10, 5e10)),
        })
        # an upcoming (unconfirmed) event
        ev_future = (today + timedelta(days=5 + idx)).isoformat()
        earnings_rows.append({
            "ticker": sym, "event_date": ev_future, "confirmed": False, "source": "seed_demo",
            "eps_est": round(rng.uniform(0.8, 3.5), 2),
        })
    sb.table("earnings_calendar").upsert(earnings_rows, on_conflict="ticker,event_date").execute()
    logger.info("earnings_calendar: %d rows", len(earnings_rows))

    # 5. News items ---------------------------------------------------------
    badges = [None, "FDA", "GUIDANCE", "M&A", "UPGRADE", "DOWNGRADE"]
    templates = [
        "{c} beats quarterly estimates on strong demand",
        "Analysts raise price target for {c}",
        "{c} announces new product line",
        "{c} faces regulatory scrutiny over pricing",
        "{c} guides above consensus for next quarter",
    ]
    news_rows = []
    for idx, (sym, name, *_rest) in enumerate(STOCKS):
        for j in range(2):
            hours = 6 + idx * 3 + j * 11
            pub = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
            headline = templates[(idx + j) % len(templates)].format(c=name.split()[0])
            news_rows.append({
                "ticker": sym, "published_at": pub, "source": "seed_demo",
                "headline": headline[:200], "url": f"https://example.local/news/{sym}/{idx}-{j}",
                "tone": round(rng.uniform(-5, 8), 2), "badge": badges[(idx + j) % len(badges)],
            })
    sb.table("news_items").upsert(news_rows, on_conflict="ticker,url").execute()
    logger.info("news_items: %d rows", len(news_rows))

    logger.info("=== Seed complete. Now run the compute pipeline. ===")


if __name__ == "__main__":
    main()
