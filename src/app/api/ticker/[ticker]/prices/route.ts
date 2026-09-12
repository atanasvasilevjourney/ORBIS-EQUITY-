import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

export const revalidate = 900;

export async function GET(
  req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker?.toUpperCase();
  if (!ticker || !/^[A-Z0-9.\-]{1,20}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const days = Math.min(parseInt(req.nextUrl.searchParams.get("days") ?? "180", 10), 730);
  const sb = createServerClient();

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);

  const { data, error } = await sb
    .from("prices_daily")
    .select("date, open, high, low, close, adj_close, volume")
    .eq("symbol", ticker)
    .gte("date", sinceStr)
    .order("date", { ascending: true });

  if (error) {
    console.error("prices query error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const bars = (data ?? []).map((r) => ({
    time: r.date,
    open: r.open ?? r.close,
    high: r.high ?? r.close,
    low: r.low ?? r.close,
    close: r.adj_close ?? r.close,
    volume: r.volume,
  }));

  return NextResponse.json({
    symbol: ticker,
    bars,
    source: "EOD",
    delayed: true,
  });
}