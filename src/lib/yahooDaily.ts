export type YahooDailyBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

async function fetchYahooChart(
  symbol: string,
  interval: "1d" | "1wk",
  range: string
): Promise<YahooDailyBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 OrbisEquity-Terminal" },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const body = await res.json();
    const result = body?.chart?.result?.[0];
    const ts: number[] = result?.timestamp ?? [];
    const q = result?.indicators?.quote?.[0] ?? {};
    const out: YahooDailyBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = Number(q.open?.[i]);
      const h = Number(q.high?.[i]);
      const l = Number(q.low?.[i]);
      const c = Number(q.close?.[i]);
      if (![o, h, l, c].every(Number.isFinite)) continue;
      const d = new Date(ts[i] * 1000);
      const date = d.toISOString().slice(0, 10);
      out.push({
        date,
        open: o,
        high: h,
        low: l,
        close: c,
        volume: Number(q.volume?.[i] ?? 0),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Adjusted daily OHLCV from Yahoo chart API (Pine-compatible EMA input). */
export async function fetchYahooDaily(symbol: string, range = "2y"): Promise<YahooDailyBar[]> {
  return fetchYahooChart(symbol, "1d", range);
}

/** Weekly OHLCV (~10y) for PB-EMA 200 on 1W charts. */
export async function fetchYahooWeekly(symbol: string, range = "10y"): Promise<YahooDailyBar[]> {
  return fetchYahooChart(symbol, "1wk", range);
}
