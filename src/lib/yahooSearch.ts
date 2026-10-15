export type SymbolSearchHit = {
  symbol: string;
  name: string;
  exchange: string;
  quoteType: string;
};

type YahooSearchQuote = {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
  quoteType?: string;
  exchDisp?: string;
};

/** Yahoo finance search — filter to US equities (optional Nasdaq venue). */
export async function searchYahooSymbols(
  query: string,
  opts?: { nasdaqOnly?: boolean; limit?: number }
): Promise<SymbolSearchHit[]> {
  const q = query.trim();
  if (q.length < 1 || q.length > 40) return [];

  const limit = Math.min(opts?.limit ?? 25, 40);
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=${limit}&newsCount=0`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 OrbisEquity-Terminal" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return [];

  const body = await res.json();
  const quotes: YahooSearchQuote[] = body?.quotes ?? [];
  const nasdaqOnly = opts?.nasdaqOnly ?? true;

  const out: SymbolSearchHit[] = [];
  for (const row of quotes) {
    const symbol = String(row.symbol ?? "").toUpperCase();
    if (!symbol || symbol.includes("=")) continue;
    const quoteType = String(row.quoteType ?? "").toUpperCase();
    if (quoteType && quoteType !== "EQUITY") continue;

    const exchange = String(row.exchange ?? row.exchDisp ?? "").toUpperCase();
    if (nasdaqOnly) {
      const onNasdaq =
        exchange === "NMS" ||
        exchange === "NGM" ||
        exchange === "NCM" ||
        exchange.includes("NASDAQ");
      if (!onNasdaq) continue;
    }

    out.push({
      symbol,
      name: String(row.shortname ?? row.longname ?? symbol),
      exchange: row.exchDisp ?? row.exchange ?? "",
      quoteType: row.quoteType ?? "EQUITY",
    });
  }
  return out;
}
