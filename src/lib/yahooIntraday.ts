import { cachedYahooJson } from "@/lib/yahooCache";

export type YahooIntradayBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** Yahoo 5m (default) — same contract as `/api/chart` intraday branch. */
export async function fetchYahooIntraday(symbol: string, interval = "5m", range = "5d"): Promise<YahooIntradayBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}&includePrePost=false&events=history`;
  try {
    const body = await cachedYahooJson(`intraday:${symbol}:${interval}:${range}`, 120_000, async () => {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 OrbisEquity-Terminal" },
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) return null;
      return res.json();
    });
    if (!body) return [];
    const result = body?.chart?.result?.[0];
    const ts: number[] = result?.timestamp ?? [];
    const q = result?.indicators?.quote?.[0] ?? {};
    const out: YahooIntradayBar[] = [];
    let lastTs = -1;
    for (let i = 0; i < ts.length; i++) {
      if (ts[i] <= lastTs) continue;
      const o = Number(q.open?.[i]);
      const h = Number(q.high?.[i]);
      const l = Number(q.low?.[i]);
      const c = Number(q.close?.[i]);
      if (![o, h, l, c].every(Number.isFinite)) continue;
      lastTs = ts[i];
      out.push({
        time: ts[i],
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
