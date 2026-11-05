import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { deskNewsFromRows, loadMarketHeadlines, type BriefNewsItem } from "@/lib/briefNews";
import {
  earningsFocusTickers,
  liquidEarnings,
  loadEarningsCalendar,
  summarizeEarnings,
  tagEarningsHeadlines,
  type DeskEarningsRow,
  type EarningsEvent,
} from "@/lib/earningsCalendar";

export const dynamic = 'force-dynamic';

export const revalidate = 900; // 15-minute cache — EOD data

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const rawTicker = sp.get("ticker");
  const ticker = rawTicker && /^[A-Z0-9.\-]{1,20}$/i.test(rawTicker) ? rawTicker : null;
  if (rawTicker && !ticker) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  const view = sp.get("view") ?? "all"; // upcoming | reported | all
  const days = Math.min(parseInt(sp.get("days") ?? "30", 10), 365);
  const limit = Math.min(parseInt(sp.get("limit") ?? "100", 10), 500);

  const now = new Date();
  const pastDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const today = now.toISOString().split("T")[0];

  let deskEarnings: DeskEarningsRow[] = [];
  let deskNews: Parameters<typeof deskNewsFromRows>[0] = [];
  try {
    const sb = createServerClient();
    let earningsQuery = sb
      .from("earnings_calendar")
      .select("ticker, event_date, confirmed, eps_est, eps_actual, surprise_pct, revenue_est, revenue_actual")
      .order("event_date", { ascending: false })
      .limit(limit);

    if (ticker) earningsQuery = earningsQuery.eq("ticker", ticker);
    if (view === "upcoming") {
      earningsQuery = earningsQuery.gte("event_date", today).lte("event_date", futureDate);
    } else if (view === "reported") {
      earningsQuery = earningsQuery.lte("event_date", today).gte("event_date", pastDate);
    } else {
      earningsQuery = earningsQuery.gte("event_date", pastDate);
    }

    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    let newsQuery = sb
      .from("news_items")
      .select("id, ticker, published_at, source, headline, url, tone, badge")
      .gte("published_at", weekAgo)
      .order("published_at", { ascending: false })
      .limit(50);
    if (ticker) newsQuery = newsQuery.eq("ticker", ticker);

    const [earningsRes, newsRes] = await Promise.all([earningsQuery, newsQuery]);
    deskEarnings = Array.isArray(earningsRes.data) ? earningsRes.data : [];
    deskNews = Array.isArray(newsRes.data) ? newsRes.data : [];
  } catch (err) {
    console.error("Earnings desk read failed:", err);
  }

  const calendar = liquidEarnings(await loadEarningsCalendar(deskEarnings));
  const filtered = calendar.filter((row) => {
    if (ticker && row.ticker !== ticker.toUpperCase()) return false;
    if (row.eventDate < pastDate || row.eventDate > futureDate) return false;
    if (view === "upcoming") return !row.confirmed && row.eventDate >= today;
    if (view === "reported") return row.confirmed && row.eventDate <= today;
    return true;
  });
  const ordered = [...filtered].sort((a, b) => {
    const aUp = !a.confirmed && a.eventDate >= today;
    const bUp = !b.confirmed && b.eventDate >= today;
    if (view !== "reported" && aUp !== bUp) return aUp ? -1 : 1;
    if (aUp && view !== "reported") {
      return a.eventDate.localeCompare(b.eventDate) || (b.marketCap ?? 0) - (a.marketCap ?? 0);
    }
    return b.eventDate.localeCompare(a.eventDate) || (b.marketCap ?? 0) - (a.marketCap ?? 0);
  });
  const visible = ordered.slice(0, limit);
  const summary = summarizeEarnings(filtered);
  const focus = ticker ? [ticker.toUpperCase()] : earningsFocusTickers(filtered, 4);
  const headlines = tagEarningsHeadlines(
    await loadMarketHeadlines(deskNewsFromRows(deskNews), 8, focus),
    focus
  ).slice(0, 12);

  const earnings = visible.map((row: EarningsEvent) => ({
    ticker: row.ticker,
    name: row.name,
    eventDate: row.eventDate,
    confirmed: row.confirmed,
    epsEst: row.epsEst,
    epsActual: row.epsActual,
    surprisePct: row.surprisePct,
    revenueEst: row.revenueEst,
    revenueActual: row.revenueActual,
    source: row.source,
  }));

  const news = headlines.map((item: BriefNewsItem) => ({
    id: item.id,
    ticker: item.ticker,
    publishedAt: item.publishedAt,
    source: item.source,
    headline: item.headline,
    url: item.url,
    tone: item.tone,
    badge: item.badge ?? null,
    origin: item.origin,
  }));

  return NextResponse.json({
    earnings,
    news,
    summary: {
      totalEarnings: filtered.length,
      reported: summary.reported,
      upcoming: summary.upcoming,
      beats: summary.beats,
      misses: summary.misses,
      avgSurprise: summary.avgSurprise,
      totalNews: news.length,
      source: summary.source,
    },
  });
}