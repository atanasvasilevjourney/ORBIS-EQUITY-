/** Investable names for Portfolio Studio. Parameters drive the shared factor path. */

export type Asset = {
  symbol: string;
  name: string;
  sector: string;
  country: string;
  countryCode: string;
  currency: string;
  color: string;
  /** Annual residual drift after market and style factors. */
  alpha: number;
  beta: number;
  /** Annual idiosyncratic volatility. */
  idioVol: number;
  smb: number;
  hml: number;
  rmw: number;
  cma: number;
  wml: number;
  /** Static quality rank, 0–100, used by the quality sleeve. */
  quality: number;
};

export const CASH = "CASH";
export const CASH_YIELD = 0.035;

export const SECTOR_COLORS: Record<string, string> = {
  "Information Technology": "#3b82f6",
  Financials: "#34d399",
  "Health Care": "#f472b6",
  Industrials: "#a78bfa",
  "Consumer Discretionary": "#f59e0b",
  "Communication Services": "#2dd4bf",
  Energy: "#fb7185",
  "Consumer Staples": "#fbbf24",
  Materials: "#38bdf8",
  Cash: "#6b7280",
};

export const FLAGS: Record<string, string> = {
  US: "🇺🇸",
  NL: "🇳🇱",
  TW: "🇹🇼",
  JP: "🇯🇵",
  DE: "🇩🇪",
  DK: "🇩🇰",
  AU: "🇦🇺",
  IN: "🇮🇳",
};

export const UNIVERSE: Asset[] = [
  asset("AAPL", "Apple", "Information Technology", "United States", "US", "USD", "#60a5fa", 0.04, 1.15, 0.18, -0.15, -0.25, 0.35, -0.15, -0.05, 86),
  asset("MSFT", "Microsoft", "Information Technology", "United States", "US", "USD", "#22c55e", 0.045, 1.05, 0.16, -0.2, -0.2, 0.4, -0.1, 0.02, 92),
  asset("NVDA", "NVIDIA", "Information Technology", "United States", "US", "USD", "#a3e635", 0.12, 1.5, 0.3, 0.05, -0.4, 0.15, -0.25, -0.1, 80),
  asset("AVGO", "Broadcom", "Information Technology", "United States", "US", "USD", "#818cf8", 0.06, 1.25, 0.24, -0.1, -0.15, 0.2, -0.1, 0.05, 78),
  asset("ASML", "ASML Holding", "Information Technology", "Netherlands", "NL", "EUR", "#fb7185", 0.05, 1.3, 0.26, -0.05, -0.2, 0.25, -0.1, 0.0, 84),
  asset("TSM", "TSMC", "Information Technology", "Taiwan", "TW", "TWD", "#2dd4bf", 0.04, 1.2, 0.24, 0.0, -0.1, 0.3, -0.05, 0.05, 88),
  asset("SAP", "SAP", "Information Technology", "Germany", "DE", "EUR", "#c084fc", 0.02, 0.95, 0.18, -0.15, 0.05, 0.2, 0.05, 0.0, 76),
  asset("INFY", "Infosys", "Information Technology", "India", "IN", "INR", "#f97316", 0.02, 0.9, 0.22, 0.15, 0.1, 0.15, 0.05, -0.05, 74),
  asset("AMZN", "Amazon.com", "Consumer Discretionary", "United States", "US", "USD", "#f59e0b", 0.03, 1.2, 0.22, 0.05, -0.3, 0.1, -0.2, -0.05, 72),
  asset("TSLA", "Tesla", "Consumer Discretionary", "United States", "US", "USD", "#ef4444", 0.02, 1.55, 0.4, 0.2, -0.45, -0.1, -0.3, -0.2, 46),
  asset("SONY", "Sony Group", "Consumer Discretionary", "Japan", "JP", "JPY", "#e879f9", 0.015, 0.95, 0.2, 0.05, 0.1, 0.05, 0.0, 0.05, 70),
  asset("GOOGL", "Alphabet", "Communication Services", "United States", "US", "USD", "#38bdf8", 0.04, 1.1, 0.2, -0.15, -0.25, 0.3, -0.15, -0.02, 82),
  asset("META", "Meta Platforms", "Communication Services", "United States", "US", "USD", "#6366f1", 0.05, 1.25, 0.28, 0.0, -0.3, 0.2, -0.2, -0.1, 74),
  asset("NFLX", "Netflix", "Communication Services", "United States", "US", "USD", "#f43f5e", 0.03, 1.15, 0.3, 0.1, -0.25, 0.05, -0.15, -0.05, 64),
  asset("JPM", "JPMorgan Chase", "Financials", "United States", "US", "USD", "#34d399", 0.01, 1.1, 0.18, 0.05, 0.5, -0.1, 0.15, -0.05, 72),
  asset("V", "Visa", "Financials", "United States", "US", "USD", "#14b8a6", 0.03, 0.95, 0.16, -0.1, -0.05, 0.35, 0.0, 0.05, 90),
  asset("LLY", "Eli Lilly", "Health Care", "United States", "US", "USD", "#f472b6", 0.07, 0.65, 0.2, -0.2, -0.25, 0.15, -0.1, 0.1, 86),
  asset("UNH", "UnitedHealth", "Health Care", "United States", "US", "USD", "#fb7185", 0.02, 0.7, 0.18, -0.1, 0.05, 0.2, 0.1, 0.05, 80),
  asset("NVO", "Novo Nordisk", "Health Care", "Denmark", "DK", "DKK", "#fda4af", 0.05, 0.75, 0.22, -0.1, -0.15, 0.25, 0.0, 0.08, 84),
  asset("CAT", "Caterpillar", "Industrials", "United States", "US", "USD", "#a78bfa", 0.015, 1.05, 0.2, 0.1, 0.25, 0.05, 0.1, 0.1, 68),
  asset("XOM", "Exxon Mobil", "Energy", "United States", "US", "USD", "#f87171", 0.0, 0.85, 0.24, 0.05, 0.35, 0.1, 0.2, -0.05, 64),
  asset("COST", "Costco", "Consumer Staples", "United States", "US", "USD", "#fbbf24", 0.025, 0.6, 0.14, -0.15, -0.05, 0.2, 0.05, 0.08, 88),
  asset("BHP", "BHP Group", "Materials", "Australia", "AU", "AUD", "#7dd3fc", 0.0, 1.05, 0.26, 0.1, 0.3, 0.05, 0.15, 0.0, 66),
  asset("LIN", "Linde", "Materials", "United States", "US", "USD", "#67e8f9", 0.02, 0.85, 0.16, -0.05, 0.1, 0.25, 0.1, 0.05, 82),
];

function asset(
  symbol: string,
  name: string,
  sector: string,
  country: string,
  countryCode: string,
  currency: string,
  color: string,
  alpha: number,
  beta: number,
  idioVol: number,
  smb: number,
  hml: number,
  rmw: number,
  cma: number,
  wml: number,
  quality: number,
): Asset {
  return {
    symbol,
    name,
    sector,
    country,
    countryCode,
    currency,
    color,
    alpha,
    beta,
    idioVol,
    smb,
    hml,
    rmw,
    cma,
    wml,
    quality,
  };
}

export const DEFAULT_HOLDINGS: { symbol: string; weight: number }[] = [
  { symbol: "AAPL", weight: 16 },
  { symbol: "MSFT", weight: 14 },
  { symbol: "NVDA", weight: 10 },
  { symbol: "AMZN", weight: 8 },
  { symbol: "GOOGL", weight: 8 },
  { symbol: "JPM", weight: 8 },
  { symbol: "LLY", weight: 8 },
  { symbol: "CAT", weight: 6 },
  { symbol: "ASML", weight: 6 },
  { symbol: "TSM", weight: 6 },
  { symbol: CASH, weight: 10 },
];

export function assetBySymbol(symbol: string): Asset | undefined {
  return UNIVERSE.find((a) => a.symbol === symbol);
}
