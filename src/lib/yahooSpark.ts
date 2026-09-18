const UA = "Mozilla/5.0 OrbisEquity-Terminal";
const CHUNK = 25;

export type SparkItem = {
  symbol?: string;
  response?: Array<{
    meta?: {
      symbol?: string;
      regularMarketPrice?: number;
      chartPreviousClose?: number;
      previousClose?: number;
    };
    timestamp?: number[];
    indicators?: {
      quote?: Array<{
        close?: (number | null)[];
        open?: (number | null)[];
        high?: (number | null)[];
        low?: (number | null)[];
        volume?: (number | null)[];
      }>;
    };
  }>;
};

async function sparkChunk(symbols: string[]): Promise<SparkItem[]> {
  if (!symbols.length) return [];
  const url =
    `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbols.join(","))}` +
    `&range=1d&interval=5m&includePrePost=true`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const body = await res.json();
  const rows = body?.spark?.result;
  return Array.isArray(rows) ? (rows as SparkItem[]) : [];
}

/** Delayed Yahoo spark (pre/post 5m). Not live Level-1. */
export async function fetchYahooSpark(symbols: string[]): Promise<SparkItem[]> {
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i]?.toUpperCase();
    if (!s || seen.has(s) || !/^[A-Z0-9.\-]{1,20}$/.test(s)) continue;
    seen.add(s);
    uniq.push(s);
  }
  const out: SparkItem[] = [];
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const chunk = uniq.slice(i, i + CHUNK);
    try {
      const rows = await sparkChunk(chunk);
      for (let j = 0; j < rows.length; j++) out.push(rows[j]);
    } catch (err) {
      console.warn("yahoo spark chunk failed", err);
    }
  }
  return out;
}
