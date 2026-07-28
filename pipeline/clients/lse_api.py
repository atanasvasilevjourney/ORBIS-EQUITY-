"""London Strategic Edge PostgREST API client.

Wraps the screener, financial reports, insider trades, earnings,
company profiles, and dividends endpoints discovered at
https://api.londonstrategicedge.com
"""
import logging
import time
from typing import Any

import requests

from pipeline.config.settings import LSEConfig

logger = logging.getLogger(__name__)


class LSEClient:
    """Client for the LSE PostgREST API (Supabase-style)."""

    def __init__(self, config: LSEConfig | None = None):
        self.cfg = config or LSEConfig()
        self.session = requests.Session()
        self.session.headers.update({
            "x-api-key": self.cfg.api_key,
            "Content-Type": "application/json",
            "Accept-Encoding": "gzip, deflate, br",
        })

    def _get(self, table: str, params: dict[str, str] | None = None,
             count: bool = False) -> list[dict[str, Any]]:
        """GET from a PostgREST table/view."""
        url = f"{self.cfg.api_url}/{table}"
        headers = {}
        if count:
            headers["Prefer"] = "count=exact"
        resp = self.session.get(url, params=params or {}, headers=headers)
        resp.raise_for_status()
        time.sleep(self.cfg.request_delay)
        return resp.json()

    # ── Stock Screener ──────────────────────────────────────────

    def get_screener(
        self,
        symbol: str | None = None,
        sector: str | None = None,
        country: str | None = None,
        countries: list[str] | None = None,
        order: str = "market_cap.desc.nullslast",
        limit: int = 5000,
    ) -> list[dict]:
        """Fetch stock screener data (1,472 global stocks, 50+ metrics)."""
        params: dict[str, str] = {
            "order": order,
            "limit": str(limit),
        }
        if symbol:
            params["symbol"] = f"eq.{symbol}"
        if sector:
            params["sector"] = f"eq.{sector}"
        if country:
            params["country"] = f"eq.{country}"
        if countries:
            params["country"] = f"in.({','.join(countries)})"
        return self._get("stock_screener", params)

    def get_screener_by_exchange(self, exchange: str, **kwargs) -> list[dict]:
        """Filter screener by exchange (NYSE, NASDAQ, LSE, XETRA, PAR, etc.)."""
        params = {"exchange": f"eq.{exchange}", **kwargs}
        return self._get("stock_screener", params)

    # ── Financial Reports ───────────────────────────────────────

    def get_financial_reports(
        self,
        symbol: str | None = None,
        report_type: str | None = None,
        period: str | None = None,
        limit: int = 1000,
    ) -> list[dict]:
        """Fetch financial reports (income/balance/cashflow/growth/metrics).

        201,433 total reports. Covers US, UK (.L), DE (.DE), FR (.PA), global.
        """
        params: dict[str, str] = {
            "order": "date.desc",
            "limit": str(limit),
        }
        if symbol:
            params["symbol"] = f"eq.{symbol}"
        if report_type:
            params["report_type"] = f"eq.{report_type}"
        if period:
            params["period"] = f"eq.{period}"
        return self._get("z_financial_reports", params)

    def get_financial_report_symbols(self) -> list[str]:
        """Get list of symbols that have financial reports."""
        rows = self._get("z_financial_reports", {
            "select": "symbol",
            "order": "symbol",
        })
        return list({r["symbol"] for r in rows})

    # ── Insider Trades ──────────────────────────────────────────

    def get_insider_trades(
        self,
        symbol: str | None = None,
        transaction_type: str | None = None,
        limit: int = 200,
        days_back: int | None = None,
    ) -> list[dict]:
        """Fetch SEC Form 4 insider trades."""
        params: dict[str, str] = {
            "order": "filing_date.desc",
            "limit": str(limit),
        }
        if symbol:
            params["symbol"] = f"eq.{symbol}"
        if transaction_type:
            params["transaction_type"] = f"eq.{transaction_type}"
        if days_back:
            from datetime import date, timedelta
            cutoff = (date.today() - timedelta(days=days_back)).isoformat()
            params["filing_date"] = f"gte.{cutoff}"
        return self._get("z_insider_trades", params)

    # ── Earnings / Company Calendar ─────────────────────────────

    def get_earnings(
        self,
        symbol: str | None = None,
        limit: int = 200,
    ) -> list[dict]:
        """Fetch earnings events from company calendar."""
        params: dict[str, str] = {
            "event_type": "eq.earnings",
            "order": "event_date.desc",
            "limit": str(limit),
        }
        if symbol:
            params["symbol"] = f"eq.{symbol}"
        return self._get("z_company_calendar", params)

    def get_dividends_calendar(
        self,
        symbol: str | None = None,
        limit: int = 200,
    ) -> list[dict]:
        """Fetch dividend events from company calendar."""
        params: dict[str, str] = {
            "event_type": "eq.dividend",
            "order": "event_date.desc",
            "limit": str(limit),
        }
        if symbol:
            params["symbol"] = f"eq.{symbol}"
        return self._get("z_company_calendar", params)

    # ── Dividends (dedicated table) ─────────────────────────────

    def get_dividends(
        self,
        symbol: str | None = None,
        limit: int = 200,
    ) -> list[dict]:
        """Fetch dividend history from dedicated dividends table."""
        params: dict[str, str] = {"limit": str(limit)}
        if symbol:
            params["symbol"] = f"eq.{symbol}"
        return self._get("dividends", params)

    # ── Company Profiles ────────────────────────────────────────

    def get_company_profile(self, symbol: str) -> dict | None:
        """Fetch company profile (CEO, description, employees, etc.)."""
        rows = self._get("z_company_profiles", {
            "symbol": f"eq.{symbol}",
            "limit": "1",
        })
        return rows[0] if rows else None

    def get_company_profiles(self, limit: int = 5000) -> list[dict]:
        """Fetch all company profiles."""
        return self._get("z_company_profiles", {"limit": str(limit)})

    # ── Convenience: bulk fetch ─────────────────────────────────

    def get_all_screener_data(self) -> list[dict]:
        """Fetch entire screener universe (all 1,472 stocks)."""
        return self.get_screener(limit=5000)

    def get_healthcare_stocks(self) -> list[dict]:
        """Fetch healthcare/pharma stocks for Module 3."""
        return self.get_screener(sector="Healthcare", limit=5000)

    def get_us_stocks(self) -> list[dict]:
        """Fetch US-only stocks."""
        return self.get_screener(country="US", limit=5000)

    def get_uk_stocks(self) -> list[dict]:
        """Fetch UK stocks."""
        return self.get_screener(country="GB", limit=5000)

    def get_eu_stocks(self) -> list[dict]:
        """Fetch EU stocks (DE, FR, NL, ES, IT, etc.)."""
        return self.get_screener(
            countries=["DE", "FR", "NL", "ES", "IT", "CH", "IE"],
            limit=5000,
        )
