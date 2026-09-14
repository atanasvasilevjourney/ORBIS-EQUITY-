/** London Strategic Edge vault + last-print helpers. Server-side only. */

export const LSE_VAULT_CANDLES = "https://api.londonstrategicedge.com/vault/candles";
export const LSE_WS_URL = "wss://data-ws.londonstrategicedge.com";

export type LseCandle = {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export function lseApiKey(): string {
  return (process.env.LSE_API_KEY ?? "").trim();
}

export function lseStreamConfigured(): boolean {
  return lseApiKey().length > 0;
}

function clampBar(o: number, h: number, l: number, c: number, vol?: number, time?: string | number): LseCandle | null {
  if (![o, h, l, c].every(Number.isFinite)) return null;
  const high = Math.max(h, o, c);
  const low = Math.min(l, o, c);
  if (low > high) return null;
  return { time: time as string | number, open: o, high, low, close: c, volume: vol };
}

export async function fetchLseVaultCandles(
  ticker: string,
  timeframe = "5m",
  limit = 400
): Promise<LseCandle[]> {
  const key = lseApiKey();
  if (!key) return [];
  const url = new URL(LSE_VAULT_CANDLES);
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("timeframe", timeframe);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("order", "desc");
  const res = await fetch(url, {
    headers: {
      "x-api-key": key,
      "User-Agent": "KovaView-Terminal (+https://londonstrategicedge.com)",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const body = await res.json();
  const rows = Array.isArray(body) ? body : [];
  const out: LseCandle[] = [];
  for (const r of rows) {
    const ts = r?.timestamp ?? r?.ts ?? r?.t ?? r?.time;
    const bar = clampBar(
      Number(r?.open ?? r?.o),
      Number(r?.high ?? r?.h),
      Number(r?.low ?? r?.l),
      Number(r?.close ?? r?.c),
      r?.volume != null || r?.v != null ? Number(r.volume ?? r.v) : undefined,
      typeof ts === "number" ? ts : ts != null ? String(ts) : undefined
    );
    if (bar) out.push(bar);
  }
  out.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return out;
}
