import { scaleOhlc } from "@/lib/adjustOhlc";
import { dropOpenCashSession, nySessionDate } from "@/lib/cashSession";
import { cachedYahooJson } from "@/lib/yahooCache";

export type YahooDailyBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** Split- and dividend-adjusted daily OHLCV from Yahoo (Pine-compatible EMA input). */
export async function fetchYahooDaily(symbol: string, range = "2y"): Promise<YahooDailyBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${encodeURIComponent(range)}&events=history&includeAdjustedClose=true&includePrePost=false`;
  try {
    const body = await cachedYahooJson(`daily:${symbol}:${range}`, 5 * 60_000, async () => {
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
    const adj: Array<number | null> | undefined = result?.indicators?.adjclose?.[0]?.adjclose;
    const out: YahooDailyBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = Number(q.open?.[i]);
      const h = Number(q.high?.[i]);
      const l = Number(q.low?.[i]);
      const c = Number(q.close?.[i]);
      if (![o, h, l, c].every(Number.isFinite)) continue;
      const adjClose = adj && Number.isFinite(Number(adj[i])) ? Number(adj[i]) : c;
      const scaled = scaleOhlc({ open: o, high: h, low: l, close: c }, adjClose);
      out.push({
        date: nySessionDate(ts[i]),
        open: scaled.open,
        high: scaled.high,
        low: scaled.low,
        close: scaled.close,
        volume: Number(q.volume?.[i] ?? 0),
      });
    }
    return dropOpenCashSession(out);
  } catch {
    return [];
  }
}
