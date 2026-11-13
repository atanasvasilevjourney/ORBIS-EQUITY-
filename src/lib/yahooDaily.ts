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

/**
 * Split- and dividend-adjusted daily OHLCV from Yahoo (Pine-compatible EMA input).
 *
 * `range=max` on this endpoint is downsampled to monthly bars. A max request
 * uses period1/period2 so the series stays daily for the whole listed history.
 */
export async function fetchYahooDaily(symbol: string, range = "2y"): Promise<YahooDailyBar[]> {
  const params = new URLSearchParams({
    interval: "1d",
    events: "history",
    includeAdjustedClose: "true",
    includePrePost: "false",
  });
  if (range === "max") {
    params.set("period1", "0");
    params.set("period2", String(Math.floor(Date.now() / 1000) + 86_400));
  } else {
    params.set("range", range);
  }
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params.toString()}`;
  const cacheKey = range === "max" ? `daily:${symbol}:max-daily` : `daily:${symbol}:${range}`;
  try {
    const body = await cachedYahooJson(cacheKey, 5 * 60_000, async () => {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 OrbisEquity-Terminal" },
        cache: "no-store",
        signal: AbortSignal.timeout(range === "max" ? 20_000 : 12_000),
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
