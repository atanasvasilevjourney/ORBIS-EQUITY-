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

export const LSE_QUOTE_FRESH_MS = 45_000;

export function quoteIsFresh(updatedAt: string | null | undefined, now = Date.now()): boolean {
  if (!updatedAt) return false;
  const t = new Date(updatedAt).getTime();
  return Number.isFinite(t) && now - t < LSE_QUOTE_FRESH_MS;
}

function clampBar(o: number, h: number, l: number, c: number, vol?: number, time?: string | number): LseCandle | null {
  if (![o, h, l, c].every(Number.isFinite)) return null;
  const high = Math.max(h, o, c);
  const low = Math.min(l, o, c);
  if (low > high) return null;
  const t = toChartTime(time);
  if (t == null) return null;
  return { time: t, open: o, high, low, close: c, volume: vol };
}

/** Lightweight-charts: daily `YYYY-MM-DD`, intraday unix seconds. */
export function toChartTime(ts: unknown): string | number | undefined {
  if (typeof ts === "number" && Number.isFinite(ts)) {
    return Math.floor(ts > 1e12 ? ts / 1000 : ts);
  }
  if (typeof ts !== "string") return undefined;
  const s = ts.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const stamped = /Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const ms = Date.parse(stamped);
  if (!Number.isFinite(ms)) return undefined;
  return Math.floor(ms / 1000);
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
      "User-Agent": "OrbisEquity-Terminal (+https://londonstrategicedge.com)",
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
