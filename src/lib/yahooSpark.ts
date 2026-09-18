const UA = "Mozilla/5.0 OrbisEquity-Terminal";
const CHUNK = 10;

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

async function sparkChunk(symbols: string[], range: string): Promise<SparkItem[]> {
  if (!symbols.length) return [];
  if (symbols.length > CHUNK) {
    const out: SparkItem[] = [];
    for (let i = 0; i < symbols.length; i += CHUNK) {
      const part = await sparkChunk(symbols.slice(i, i + CHUNK), range);
      for (let j = 0; j < part.length; j++) out.push(part[j]);
    }
    return out;
  }
  const url =
    `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${symbols.map(encodeURIComponent).join(",")}` +
    `&range=${encodeURIComponent(range)}&interval=5m&includePrePost=true`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    if (symbols.length > 1) {
      const mid = Math.ceil(symbols.length / 2);
      const a = await sparkChunk(symbols.slice(0, mid), range);
      const b = await sparkChunk(symbols.slice(mid), range);
      return a.concat(b);
    }
    return [];
  }
  const body = await res.json();
  const rows = body?.spark?.result;
  return Array.isArray(rows) ? (rows as SparkItem[]) : [];
}

/** Delayed Yahoo spark (pre/post 5m). Not live Level-1. */
export async function fetchYahooSpark(symbols: string[], range = "1d"): Promise<SparkItem[]> {
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
      const rows = await sparkChunk(chunk, range);
      for (let j = 0; j < rows.length; j++) out.push(rows[j]);
    } catch (err) {
      console.warn("yahoo spark chunk failed", err);
    }
  }
  return out;
}
