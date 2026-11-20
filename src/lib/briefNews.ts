/** Brief-news rows for the landing page. Desk headlines lead; Yahoo fills the rest. */

import { cachedYahooJson } from "@/lib/yahooCache";

export type NewsOrigin = "desk" | "yahoo";

export type BriefNewsItem = {
  id: string;
  headline: string;
  source: string;
  url: string | null;
  publishedAt: string | null;
  ticker: string | null;
  tone: number | null;
  origin: NewsOrigin;
  badge?: "earnings" | null;
};

export type StoredNewsRow = {
  id?: number | string | null;
  ticker?: string | null;
  published_at?: string | null;
  source?: string | null;
  headline?: string | null;
  url?: string | null;
  tone?: number | null;
};

const QUERIES = ["SPY", "QQQ", "IWM"];

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (!url.startsWith("https://") && !url.startsWith("http://")) return null;
  return url;
}

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function deskNewsFromRows(rows: StoredNewsRow[]): BriefNewsItem[] {
  const out: BriefNewsItem[] = [];
  for (const row of rows) {
    const headline = String(row.headline ?? "").trim();
    if (!headline) continue;
    const id = row.id == null ? headline : String(row.id);
    out.push({
      id: `desk-${id}`,
      headline: headline.slice(0, 220),
      source: String(row.source ?? "Desk").trim() || "Desk",
      url: httpUrl(row.url),
      publishedAt: row.published_at ?? null,
      ticker: row.ticker ? String(row.ticker).toUpperCase() : null,
      tone: finite(row.tone),
      origin: "desk",
    });
  }
  return out;
}

type YahooNews = {
  uuid?: string;
  title?: string;
  publisher?: string;
  link?: string;
  providerPublishTime?: number;
  relatedTickers?: string[];
};

export function yahooNewsItems(body: unknown): BriefNewsItem[] {
  const news = (body as { news?: YahooNews[] } | null)?.news;
  if (!Array.isArray(news)) return [];
  const out: BriefNewsItem[] = [];
  for (const row of news) {
    const headline = String(row.title ?? "").trim();
    if (!headline) continue;
    const published =
      typeof row.providerPublishTime === "number" && Number.isFinite(row.providerPublishTime)
        ? new Date(row.providerPublishTime * 1000).toISOString()
        : null;
    const ticker = row.relatedTickers?.find((symbol) => /^[A-Z]{1,6}$/.test(symbol)) ?? null;
    out.push({
      id: `yahoo-${row.uuid || headline}`,
      headline: headline.slice(0, 220),
      source: String(row.publisher ?? "Yahoo").trim() || "Yahoo",
      url: httpUrl(row.link),
      publishedAt: published,
      ticker,
      tone: null,
      origin: "yahoo",
    });
  }
  return out;
}

export function dedupeNews(items: BriefNewsItem[], limit = 6): BriefNewsItem[] {
  const seen = new Set<string>();
  const out: BriefNewsItem[] = [];
  for (const item of items) {
    const key = (item.url || item.headline).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export function newsSource(items: BriefNewsItem[]): "desk" | "yahoo" | "mixed" | "none" {
  const origins = new Set(items.map((item) => item.origin));
  if (origins.size === 0) return "none";
  if (origins.size > 1) return "mixed";
  return origins.has("desk") ? "desk" : "yahoo";
}

async function fetchQuery(query: string): Promise<BriefNewsItem[]> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=0&newsCount=6`;
  const body = await cachedYahooJson(`news:${query}`, 5 * 60_000, async () => {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 OrbisEquity-Terminal" },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    return res.json();
  });
  return yahooNewsItems(body);
}

export async function fetchYahooHeadlines(queries: string[] = QUERIES): Promise<BriefNewsItem[]> {
  const unique: string[] = [];
  for (const query of queries) {
    const trimmed = query.trim();
    if (!trimmed || unique.includes(trimmed)) continue;
    unique.push(trimmed);
  }
  const batches = await Promise.all(
    unique.slice(0, 6).map(async (query) => {
      try {
        return await fetchQuery(query);
      } catch {
        return [];
      }
    })
  );
  return dedupeNews(batches.flat(), 18);
}

export async function loadMarketHeadlines(
  stored: BriefNewsItem[],
  limit = 6,
  focus: string[] = []
): Promise<BriefNewsItem[]> {
  const queries = [...focus, ...QUERIES];
  let live: BriefNewsItem[] = [];
  const desk = dedupeNews(stored, limit);
  if (desk.length < limit || focus.length > 0) {
    try {
      live = await fetchYahooHeadlines(queries);
    } catch {
      live = [];
    }
  }
  return dedupeNews([...stored, ...live], Math.max(limit, focus.length > 0 ? 12 : limit));
}
