import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const ticker = sp.get("ticker");
  const view = sp.get("view") ?? "all"; // upcoming | reported | all
  const days = parseInt(sp.get("days") ?? "30", 10);
  const limit = Math.min(parseInt(sp.get("limit") ?? "100", 10), 500);

  const sb = createServerClient();

  // Calculate date range
  const now = new Date();
  const pastDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const today = now.toISOString().split("T")[0];

  // Fetch earnings
  let earningsQuery = sb
    .from("earnings_calendar")
    .select("*")
    .order("event_date", { ascending: false })
    .limit(limit);

  if (ticker) {
    earningsQuery = earningsQuery.eq("ticker", ticker);
  }

  if (view === "upcoming") {
    earningsQuery = earningsQuery.gte("event_date", today).lte("event_date", futureDate);
  } else if (view === "reported") {
    earningsQuery = earningsQuery.lte("event_date", today).gte("event_date", pastDate);
  } else {
    earningsQuery = earningsQuery.gte("event_date", pastDate);
  }

  // Fetch news (last 7 days, limited)
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let newsQuery = sb
    .from("news_items")
    .select("*")
    .gte("published_at", weekAgo)
    .order("published_at", { ascending: false })
    .limit(50);

  if (ticker) {
    newsQuery = newsQuery.eq("ticker", ticker);
  }

  const [earningsRes, newsRes] = await Promise.all([
    earningsQuery,
    newsQuery,
  ]);

  const earnings = (earningsRes.data ?? []).map((e: any) => ({
    ticker: e.ticker,
    eventDate: e.event_date,
    confirmed: e.confirmed,
    epsEst: e.eps_est,
    epsActual: e.eps_actual,
    surprisePct: e.surprise_pct,
    revenueEst: e.revenue_est,
    revenueActual: e.revenue_actual,
  }));

  const news = (newsRes.data ?? []).map((n: any) => ({
    id: n.id,
    ticker: n.ticker,
    publishedAt: n.published_at,
    source: n.source,
    headline: n.headline,
    url: n.url,
    tone: n.tone,
    badge: n.badge,
  }));

  // Summary stats
  const reported = earnings.filter((e: any) => e.confirmed);
  const upcoming = earnings.filter((e: any) => !e.confirmed);
  const beats = reported.filter((e: any) => e.surprisePct != null && e.surprisePct > 0);
  const misses = reported.filter((e: any) => e.surprisePct != null && e.surprisePct < 0);
  const avgSurprise = beats.length + misses.length > 0
    ? reported.reduce((s: number, e: any) => s + (e.surprisePct ?? 0), 0) / reported.filter((e: any) => e.surprisePct != null).length
    : 0;

  return NextResponse.json({
    earnings,
    news,
    summary: {
      totalEarnings: earnings.length,
      reported: reported.length,
      upcoming: upcoming.length,
      beats: beats.length,
      misses: misses.length,
      avgSurprise: Math.round(avgSurprise * 10) / 10,
      totalNews: news.length,
    },
  });
}
