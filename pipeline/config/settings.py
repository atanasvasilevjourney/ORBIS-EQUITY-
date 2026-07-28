"""KovaView pipeline configuration."""
import os
from dataclasses import dataclass, field

@dataclass
class LSEConfig:
    api_url: str = os.getenv("LSE_API_URL", "https://api.londonstrategicedge.com")
    api_key: str = os.getenv("LSE_API_KEY", "71f880e1d2ef471664f3b6c04c6dc1e618f94e51f68c87522bc6dcbc0ca173a5")
    data_api_url: str = os.getenv("LSE_DATA_API_URL", "https://data-api.londonstrategicedge.com")
    max_rows_per_request: int = 5000
    request_delay: float = 0.2

@dataclass
class SupabaseConfig:
    url: str = os.getenv("SUPABASE_URL", "")
    anon_key: str = os.getenv("SUPABASE_ANON_KEY", "")
    service_key: str = os.getenv("SUPABASE_SERVICE_KEY", "")

@dataclass
class UniverseTier:
    name: str
    source: str  # "lse" | "yfinance" | "both"
    fundamentals_source: str  # "lse" | "yfinance" | "fmp"

UNIVERSE_TIERS = {
    "us_large": UniverseTier("S&P 500", "lse", "lse"),
    "us_mid": UniverseTier("S&P 400", "lse", "lse"),
    "us_small": UniverseTier("S&P 600", "lse", "lse"),
    "us_micro": UniverseTier("LSE Catalog Remainder", "lse", "lse"),
    "uk": UniverseTier("FTSE 100 + FTSE 250", "yfinance", "yfinance"),
    "eu": UniverseTier("EURO STOXX 50 + DAX + CAC", "yfinance", "yfinance"),
}

# Screener API table → fields mapping
SCREENER_FIELDS = [
    "symbol", "company_name", "sector", "industry", "country", "exchange",
    "currency", "price", "market_cap", "beta", "volume", "average_volume",
    "week_52_low", "week_52_high", "pe_ratio", "pb_ratio", "ps_ratio",
    "p_fcf_ratio", "ev_ebitda", "ev_sales", "earnings_yield", "fcf_yield",
    "dividend_yield", "dividend_payout_ratio", "dividend_per_share",
    "gross_margin", "operating_margin", "net_margin", "roe", "roa", "roic",
    "current_ratio", "quick_ratio", "cash_ratio", "debt_to_equity",
    "debt_to_assets", "revenue", "gross_profit", "operating_income",
    "net_income", "ebitda", "eps", "eps_diluted", "revenue_growth_1y",
    "revenue_growth_3y", "revenue_growth_5y", "net_income_growth_1y",
    "net_income_growth_3y", "net_income_growth_5y", "eps_growth_1y",
    "dividend_growth_1y", "book_value_growth_1y", "is_etf",
    "is_actively_trading", "ipo_date", "ratios_date", "updated_at",
]

FINANCIAL_REPORT_TYPES = ["income", "balance", "cashflow", "growth", "metrics"]
FINANCIAL_PERIODS = ["FY", "Q1", "Q2", "Q3", "Q4"]

# Healthcare sectors/industries for pharma module
PHARMA_INDUSTRIES = [
    "Drug Manufacturers - General",
    "Drug Manufacturers - Specialty & Generic",
    "Biotechnology",
    "Diagnostics & Research",
    "Medical - Instruments & Supplies",
    "Medical - Healthcare Plans",
    "Medical - Care Facilities",
    "Medical - Distribution",
    "Medical - Pharmaceuticals",
]
